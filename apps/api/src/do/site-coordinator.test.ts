import { describe, expect, it, vi } from "vitest";
import { MAX_DEPTH, MAX_PAGES } from "../crawler/frontier";
import { MAX_RENDERED_PAGES_PER_RUN } from "../crawler/render-budget";
import { createTestEnv as createTestEnvironment, FakeDb as FakeDatabase } from "../test-helpers";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    protected ctx: DurableObjectState;

    constructor(ctx: DurableObjectState) {
      this.ctx = ctx;
    }
  },
}));

const siteCoordinatorModule = await import("./site-coordinator");
type Coordinator = InstanceType<typeof siteCoordinatorModule.SiteCoordinator>;

interface PostResult<T> {
  status: number;
  body: T;
}

function fakeStorage(): Pick<DurableObjectStorage, "get" | "put"> {
  const map = new Map<string, unknown>();
  return {
    get: ((key: string): Promise<unknown> =>
      Promise.resolve(map.get(key))) as DurableObjectStorage["get"],
    put: ((key: string, value: unknown): Promise<void> => {
      map.set(key, value);
      return Promise.resolve();
    }) as DurableObjectStorage["put"],
  };
}

function fakeContext(): DurableObjectState {
  return { storage: fakeStorage() } as unknown as DurableObjectState;
}

function coordinator(): Coordinator {
  return new siteCoordinatorModule.SiteCoordinator(
    fakeContext(),
    createTestEnvironment(new FakeDatabase()),
  );
}

async function post<T>(co: Coordinator, path: string, body: unknown): Promise<PostResult<T>> {
  const res = await co.fetch(
    new Request(`https://do${path}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as T };
}

async function status(co: Coordinator): Promise<{
  phase: string;
  pagesFound: number;
  pagesCrawled: number;
  renderedPages: number;
  frontierSize: number;
}> {
  const res = await co.fetch(new Request("https://do/status"));
  return await res.json();
}

async function claim(
  co: Coordinator,
  runId: string,
  options: Partial<{ followLinks: boolean; origin: string }> = {},
): Promise<PostResult<unknown>> {
  return post(co, "/claim", {
    runId,
    origin: options.origin ?? "https://example.com",
    disallow: [],
    discoveryMethod: "sitemap",
    followLinks: options.followLinks ?? false,
  });
}

async function seedUrl(
  co: Coordinator,
  runId: string,
  url = "https://example.com/a",
): Promise<void> {
  await post(co, "/seed", {
    runId,
    urls: [url],
    baseUrl: "https://example.com/",
    depth: 0,
  });
}

async function claimRender(
  co: Coordinator,
  runId: string,
  url = "https://example.com/a",
): Promise<PostResult<{ accepted: boolean; renderedPages: number }>> {
  return post(co, "/claim-render", {
    runId,
    url,
  });
}

describe("SiteCoordinator", () => {
  it("constructs and reports idle status", async () => {
    await expect(status(coordinator())).resolves.toMatchObject({ phase: "idle", pagesFound: 0 });
  });

  it("rejects a different active run and releases the mutex after finish", async () => {
    const co = coordinator();
    await expect(claim(co, "run-a")).resolves.toMatchObject({ status: 200 });

    const conflict = await claim(co, "run-b");
    expect(conflict).toMatchObject({
      status: 409,
      body: { error: "run_in_progress", runId: "run-a" },
    });

    await post(co, "/finish", { runId: "run-a", phase: "done" });
    await expect(claim(co, "run-b")).resolves.toMatchObject({ status: 200 });
  });

  it("rejects a fresh active run from a different runId", async () => {
    const co = coordinator();
    await claim(co, "run-a");

    await expect(claim(co, "run-b")).resolves.toMatchObject({ status: 409 });
  });

  it("does not take over an active run before the stale timeout", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const co = coordinator();
      await claim(co, "run-a");

      vi.setSystemTime(59 * 60 * 1000);

      await expect(claim(co, "run-b")).resolves.toMatchObject({ status: 409 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes over a stale active run after the timeout", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const co = coordinator();
      await claim(co, "run-a");

      vi.setSystemTime(60 * 60 * 1000 + 1);

      await expect(claim(co, "run-b")).resolves.toMatchObject({ status: 200 });
      await expect(status(co)).resolves.toMatchObject({ phase: "discovering" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores seed calls for foreign runs", async () => {
    const co = coordinator();
    await claim(co, "run-a");

    const seeded = await post<{ accepted: unknown[] }>(co, "/seed", {
      runId: "run-b",
      urls: ["https://example.com/a"],
      baseUrl: "https://example.com/",
      depth: 0,
    });

    expect(seeded.body.accepted).toEqual([]);
    expect(await status(co)).toMatchObject({ phase: "discovering", pagesFound: 0 });
  });

  it("seeds unique same-origin URLs and enforces the page budget", async () => {
    const co = coordinator();
    await claim(co, "run-a");
    const urls = Array.from(
      { length: MAX_PAGES + 5 },
      (_, i) => `https://example.com/p${String(i)}`,
    );

    const seeded = await post<{ accepted: { url: string; depth: number }[] }>(co, "/seed", {
      runId: "run-a",
      urls: [urls[0], ...urls, "https://other.test/x"],
      baseUrl: "https://example.com/",
      depth: 0,
    });

    expect(seeded.body.accepted).toHaveLength(MAX_PAGES);
    expect(new Set(seeded.body.accepted.map((u) => u.url)).size).toBe(MAX_PAGES);
    expect(await status(co)).toMatchObject({ phase: "crawling", pagesFound: MAX_PAGES });
  });

  it("drains a single completed URL", async () => {
    const co = coordinator();
    await claim(co, "run-a");
    await post(co, "/seed", {
      runId: "run-a",
      urls: ["https://example.com/a"],
      baseUrl: "https://example.com/",
      depth: 0,
    });

    const completed = await post<{ drained: boolean; pagesCrawled: number }>(co, "/complete", {
      runId: "run-a",
      url: "https://example.com/a",
      depth: 0,
    });

    expect(completed.body).toMatchObject({ drained: true, pagesCrawled: 1 });
    expect(await status(co)).toMatchObject({ phase: "generating", pagesCrawled: 1 });
  });

  it("admits discovered links below the depth cap but not at the cap", async () => {
    const co = coordinator();
    await claim(co, "run-a", { followLinks: true });
    await post(co, "/seed", {
      runId: "run-a",
      urls: ["https://example.com/a", "https://example.com/deep"],
      baseUrl: "https://example.com/",
      depth: 0,
    });

    const belowCap = await post<{ accepted: { url: string; depth: number }[]; drained: boolean }>(
      co,
      "/complete",
      {
        runId: "run-a",
        url: "https://example.com/a",
        links: ["https://example.com/b"],
        depth: MAX_DEPTH - 1,
      },
    );
    expect(belowCap.body.accepted).toEqual([{ url: "https://example.com/b", depth: MAX_DEPTH }]);
    expect(belowCap.body.drained).toBe(false);

    const atCap = await post<{ accepted: { url: string; depth: number }[] }>(co, "/complete", {
      runId: "run-a",
      url: "https://example.com/deep",
      links: ["https://example.com/c"],
      depth: MAX_DEPTH,
    });
    expect(atCap.body.accepted).toEqual([]);
  });

  it("ignores complete calls for foreign runs", async () => {
    const co = coordinator();
    await claim(co, "run-a");
    await post(co, "/seed", {
      runId: "run-a",
      urls: ["https://example.com/a"],
      baseUrl: "https://example.com/",
      depth: 0,
    });

    const completed = await post<{
      pagesFound: number;
      pagesCrawled: number;
      drained: boolean;
      capped: boolean;
    }>(co, "/complete", {
      runId: "run-b",
      url: "https://example.com/a",
      depth: 0,
    });

    expect(completed.body).toEqual({
      accepted: [],
      drained: false,
      pagesFound: 0,
      pagesCrawled: 0,
      capped: false,
    });
    expect(await status(co)).toMatchObject({ pagesFound: 1, pagesCrawled: 0 });
  });

  it("reports when the page budget was exhausted", async () => {
    const co = coordinator();
    await claim(co, "run-a");
    const urls = Array.from(
      { length: MAX_PAGES + 1 },
      (_, i) => `https://example.com/p${String(i)}`,
    );
    await post(co, "/seed", {
      runId: "run-a",
      urls,
      baseUrl: "https://example.com/",
      depth: 0,
    });

    const completed = await post<{ capped: boolean }>(co, "/complete", {
      runId: "run-a",
      url: "https://example.com/p0",
      depth: 0,
    });

    expect(completed.body.capped).toBe(true);
  });

  it("counts duplicate complete calls only once", async () => {
    const co = coordinator();
    await claim(co, "run-a");
    await post(co, "/seed", {
      runId: "run-a",
      urls: ["https://example.com/a"],
      baseUrl: "https://example.com/",
      depth: 0,
    });

    await post(co, "/complete", { runId: "run-a", url: "https://example.com/a", depth: 0 });
    const duplicate = await post<{ pagesCrawled: number }>(co, "/complete", {
      runId: "run-a",
      url: "https://example.com/a",
      depth: 0,
    });

    expect(duplicate.body.pagesCrawled).toBe(1);
  });

  it("claims browser render budget for in-flight pages only", async () => {
    const co = coordinator();
    await claim(co, "run-a");
    await seedUrl(co, "run-a");

    const foreign = await post<{ accepted: boolean }>(co, "/claim-render", {
      runId: "run-b",
      url: "https://example.com/a",
    });
    const accepted = await claimRender(co, "run-a");

    expect(foreign.body.accepted).toBe(false);
    expect(accepted.body).toMatchObject({ accepted: true, renderedPages: 1 });
    expect(await status(co)).toMatchObject({ renderedPages: 1 });
  });

  it("releases a claimed browser render slot", async () => {
    const co = coordinator();
    await claim(co, "run-a");
    await seedUrl(co, "run-a");

    await expect(claimRender(co, "run-a")).resolves.toMatchObject({
      body: { accepted: true, renderedPages: 1 },
    });

    const released = await post<{ renderedPages: number }>(co, "/release-render", {
      runId: "run-a",
    });

    expect(released.body.renderedPages).toBe(0);
    expect(await status(co)).toMatchObject({ renderedPages: 0 });
  });

  it("does not release browser render slots below zero", async () => {
    const co = coordinator();
    await claim(co, "run-a");

    const released = await post<{ renderedPages: number }>(co, "/release-render", {
      runId: "run-a",
    });

    expect(released.body.renderedPages).toBe(0);
    expect(await status(co)).toMatchObject({ renderedPages: 0 });
  });

  it("ignores browser render release calls for foreign runs", async () => {
    const co = coordinator();
    await claim(co, "run-a");
    await seedUrl(co, "run-a");
    await expect(claimRender(co, "run-a")).resolves.toMatchObject({
      body: { accepted: true, renderedPages: 1 },
    });

    const released = await post<{ renderedPages: number }>(co, "/release-render", {
      runId: "run-b",
    });

    expect(released.body.renderedPages).toBe(1);
    expect(await status(co)).toMatchObject({ renderedPages: 1 });
  });

  it("enforces the browser render budget per run", async () => {
    const co = coordinator();
    await claim(co, "run-a");
    const urls = Array.from(
      { length: MAX_RENDERED_PAGES_PER_RUN + 1 },
      (_, i) => `https://example.com/p${String(i)}`,
    );
    await post(co, "/seed", {
      runId: "run-a",
      urls,
      baseUrl: "https://example.com/",
      depth: 0,
    });

    for (const url of urls.slice(0, MAX_RENDERED_PAGES_PER_RUN)) {
      const result = await post<{ accepted: boolean }>(co, "/claim-render", {
        runId: "run-a",
        url,
      });
      expect(result.body.accepted).toBe(true);
    }

    const overBudget = await post<{ accepted: boolean; renderedPages: number }>(
      co,
      "/claim-render",
      {
        runId: "run-a",
        url: urls[MAX_RENDERED_PAGES_PER_RUN],
      },
    );

    expect(overBudget.body).toMatchObject({
      accepted: false,
      renderedPages: MAX_RENDERED_PAGES_PER_RUN,
    });
  });

  it("keeps the real count when one of several URLs is completed twice", async () => {
    const co = coordinator();
    await claim(co, "run-a");
    await post(co, "/seed", {
      runId: "run-a",
      urls: ["https://example.com/a", "https://example.com/b"],
      baseUrl: "https://example.com/",
      depth: 0,
    });

    await post(co, "/complete", { runId: "run-a", url: "https://example.com/a", depth: 0 });
    await post(co, "/complete", { runId: "run-a", url: "https://example.com/a", depth: 0 });
    const completed = await post<{ pagesCrawled: number; drained: boolean }>(co, "/complete", {
      runId: "run-a",
      url: "https://example.com/b",
      depth: 0,
    });

    expect(completed.body).toMatchObject({ pagesCrawled: 2, drained: true });
  });
});
