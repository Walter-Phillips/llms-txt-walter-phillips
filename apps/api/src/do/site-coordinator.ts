import { DurableObject } from "cloudflare:workers";
import type { Env } from "../bindings";
import { acceptUrls, MAX_DEPTH, MAX_PAGES } from "../crawler/frontier";

type Phase = "idle" | "discovering" | "crawling" | "generating" | "done" | "error";

type State = {
  runId: string | null;
  phase: Phase;
  origin: string | null;
  disallow: string[];
  discoveryMethod: string | null;
  /** sitemap mode ignores discovered links; links mode seeds them (BFS) */
  followLinks: boolean;
  pagesFound: number;
  pagesCrawled: number;
  inFlight: string[];
  seen: string[];
  depths: Record<string, number>;
};

const IDLE_STATE: State = {
  runId: null,
  phase: "idle",
  origin: null,
  disallow: [],
  discoveryMethod: null,
  followLinks: false,
  pagesFound: 0,
  pagesCrawled: 0,
  inFlight: [],
  seen: [],
  depths: {},
};

export type ClaimRequest = {
  runId: string;
  origin: string;
  disallow: string[];
  discoveryMethod: string;
  followLinks: boolean;
};
export type SeedRequest = { runId: string; urls: string[]; baseUrl: string; depth: number };
export type SeedResponse = { accepted: { url: string; depth: number }[] };
export type CompleteRequest = { runId: string; url: string; links?: string[]; depth: number };
export type CompleteResponse = SeedResponse & {
  drained: boolean;
  pagesFound: number;
  pagesCrawled: number;
};

/**
 * One SiteCoordinator per domain. Owns the URL frontier, dedupes,
 * tracks live progress, and serves as the per-site mutex.
 *
 * State here is *runtime* coordination state (persisted to DO storage so it
 * survives eviction). D1 is the durable record once a run finishes.
 */
export class SiteCoordinator extends DurableObject<Env> {
  private state: State = IDLE_STATE;
  private loaded = false;

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.state = (await this.ctx.storage.get<State>("state")) ?? structuredClone(IDLE_STATE);
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put("state", this.state);
  }

  async fetch(req: Request): Promise<Response> {
    await this.load();
    const url = new URL(req.url);
    switch (url.pathname) {
      case "/status":
        return Response.json(this.snapshot());
      case "/claim":
        return this.claim((await req.json()) as ClaimRequest);
      case "/seed":
        return this.seed((await req.json()) as SeedRequest);
      case "/complete":
        return this.complete((await req.json()) as CompleteRequest);
      case "/finish":
        return this.finish((await req.json()) as { runId: string; phase: "done" | "error" });
      default:
        return new Response("not found", { status: 404 });
    }
  }

  /** Per-site mutex: a new run can only start when no run is active. */
  private async claim(body: ClaimRequest): Promise<Response> {
    const active =
      this.state.runId !== null &&
      this.state.runId !== body.runId &&
      ["discovering", "crawling", "generating"].includes(this.state.phase);
    if (active) {
      return Response.json({ error: "run_in_progress", runId: this.state.runId }, { status: 409 });
    }
    this.state = {
      ...structuredClone(IDLE_STATE),
      runId: body.runId,
      phase: "discovering",
      origin: body.origin,
      disallow: body.disallow,
      discoveryMethod: body.discoveryMethod,
      followLinks: body.followLinks,
    };
    await this.save();
    return Response.json({ ok: true });
  }

  private async seed(body: SeedRequest): Promise<Response> {
    if (body.runId !== this.state.runId) return Response.json({ accepted: [] });
    const accepted = this.admit(body.urls, body.baseUrl, body.depth);
    this.state.phase = "crawling";
    await this.save();
    return Response.json({ accepted } satisfies SeedResponse);
  }

  private async complete(body: CompleteRequest): Promise<Response> {
    if (body.runId !== this.state.runId) {
      return Response.json({
        accepted: [],
        drained: false,
        pagesFound: 0,
        pagesCrawled: 0,
      } satisfies CompleteResponse);
    }

    this.state.inFlight = this.state.inFlight.filter((u) => u !== body.url);
    this.state.pagesCrawled++;

    let accepted: { url: string; depth: number }[] = [];
    if (this.state.followLinks && body.links?.length && body.depth < MAX_DEPTH) {
      accepted = this.admit(body.links, body.url, body.depth + 1);
    }

    const drained = this.state.inFlight.length === 0 && accepted.length === 0;
    if (drained) this.state.phase = "generating";
    await this.save();

    return Response.json({
      accepted,
      drained,
      pagesFound: this.state.pagesFound,
      pagesCrawled: this.state.pagesCrawled,
    } satisfies CompleteResponse);
  }

  private async finish(body: { runId: string; phase: "done" | "error" }): Promise<Response> {
    if (body.runId === this.state.runId) {
      this.state.phase = body.phase;
      await this.save();
    }
    return Response.json({ ok: true });
  }

  private admit(candidates: string[], baseUrl: string, depth: number): { url: string; depth: number }[] {
    const seen = new Set(this.state.seen);
    const urls = acceptUrls({
      candidates,
      baseUrl,
      origin: this.state.origin ?? "",
      seen,
      disallow: this.state.disallow,
      pageBudget: Math.max(0, MAX_PAGES - this.state.pagesFound),
    });
    for (const url of urls) {
      this.state.seen.push(url);
      this.state.inFlight.push(url);
      this.state.depths[url] = depth;
      this.state.pagesFound++;
    }
    return urls.map((url) => ({ url, depth }));
  }

  private snapshot() {
    return {
      runId: this.state.runId,
      phase: this.state.phase,
      pagesFound: this.state.pagesFound,
      pagesCrawled: this.state.pagesCrawled,
      discoveryMethod: this.state.discoveryMethod,
      frontierSize: this.state.inFlight.length,
      inFlight: this.state.inFlight.length,
    };
  }
}
