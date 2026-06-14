import type {
  FileVersion,
  JobStatusResponse,
  PageInventoryItem,
  Run,
  Site,
} from "@profound-takehome/shared";
import { ApiRequestError, type LlmsApi } from "./api";
import { unifiedDiff } from "./diff";

/**
 * In-memory mock of the Worker API. Simulates a full crawl on a wall-clock
 * timeline so the progress screen animates exactly as it would against the
 * real backend. Deterministic given a fixed clock — tests drive it with
 * vi.useFakeTimers + vi.setSystemTime.
 *
 * Submit a URL whose hostname contains "error" to exercise the failure path.
 */
export const MOCK_TIMELINE = {
  queuedUntil: 1200,
  crawlingUntil: 6000,
  generatingUntil: 7800,
  pagesFound: 24,
  errorAt: 2000,
} as const;

interface MockRun {
  runId: string;
  siteId: string;
  startedAt: number;
  shouldFail: boolean;
  /** Version number this run publishes when it finishes. */
  publishesVersion: number;
}

interface MockSite {
  site: Site;
  versions: FileVersion[];
  contents: Map<number, string>;
  pages: PageInventoryItem[];
}

const sites = new Map<string, MockSite>();
const sitesByOrigin = new Map<string, string>();
const runs = new Map<string, MockRun>();
let runCounter = 0;

function hostnameFromOrigin(origin: string): string {
  return new URL(origin).hostname;
}

function slugify(origin: string): string {
  return hostnameFromOrigin(origin).replace(/[^a-z0-9]+/gi, "-");
}

function titleCase(origin: string): string {
  const name = hostnameFromOrigin(origin).replace(/^www\./, "").split(".")[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function makeLlmsTxt(origin: string, version: number): string {
  const host = hostnameFromOrigin(origin);
  const name = titleCase(origin);
  const lines = [
    `# ${name}`,
    "",
    `> ${name} builds developer tooling. This file lists the canonical pages of ${host} for language models.`,
    "",
    `${name} publishes product pages, documentation, and a changelog. URLs below are stable and crawlable.`,
    "",
    "## Docs",
    "",
    `- [Quickstart](${origin}/docs/quickstart): Install, configure, and ship in five minutes`,
    `- [API reference](${origin}/docs/api): Complete endpoint and type reference`,
    version >= 2
      ? `- [Authentication](${origin}/docs/auth): Token issuance, scopes, and rotation`
      : null,
    `- [Self-hosting](${origin}/docs/self-hosting): Run the platform on your own infrastructure`,
    "",
    "## Product",
    "",
    `- [Pricing](${origin}/pricing): Plans, limits, and overage policy`,
    `- [Integrations](${origin}/integrations): First-party connectors and webhooks`,
    version >= 3 ? `- [Changelog](${origin}/changelog): Dated release notes, newest first` : null,
    "",
    "## Optional",
    "",
    `- [Blog](${origin}/blog): Engineering notes and release deep-dives`,
    `- [About](${origin}/about): Company, team, and contact details`,
  ].filter((l): l is string => l !== null);
  return lines.join("\n") + "\n";
}

function makePages(origin: string): PageInventoryItem[] {
  return [
    { url: `${origin}/`, title: `${titleCase(origin)} — Home`, description: "Landing page", sectionHint: null, status: "ok" },
    { url: `${origin}/docs/quickstart`, title: "Quickstart", description: "Install and ship in five minutes", sectionHint: "Docs", status: "ok" },
    { url: `${origin}/docs/api`, title: "API reference", description: "Endpoints and types", sectionHint: "Docs", status: "ok" },
    { url: `${origin}/docs/auth`, title: "Authentication", description: "Tokens, scopes, rotation", sectionHint: "Docs", status: "ok" },
    { url: `${origin}/docs/self-hosting`, title: "Self-hosting", description: "Run on your own infra", sectionHint: "Docs", status: "ok" },
    { url: `${origin}/pricing`, title: "Pricing", description: "Plans and limits", sectionHint: "Product", status: "ok" },
    { url: `${origin}/integrations`, title: "Integrations", description: "Connectors and webhooks", sectionHint: "Product", status: "ok" },
    { url: `${origin}/changelog`, title: "Changelog", description: "Release notes", sectionHint: "Product", status: "ok" },
    { url: `${origin}/blog`, title: "Blog", description: "Engineering notes", sectionHint: "Optional", status: "ok" },
    { url: `${origin}/about`, title: "About", description: "Company and contact", sectionHint: "Optional", status: "ok" },
    { url: `${origin}/admin`, title: null, description: null, sectionHint: null, status: "skipped" },
    { url: `${origin}/search`, title: "Search", description: null, sectionHint: null, status: "excluded" },
  ];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function ensureSite(origin: string): MockSite {
  const existingId = sitesByOrigin.get(origin);
  if (existingId) return sites.get(existingId)!;

  const id = `site_${slugify(origin)}`;
  const now = Date.now();
  // Seed two backdated versions so history + diffs are demoable on the very
  // first run (mock-only behavior; the real API starts at version 1).
  const seeded: FileVersion[] = [1, 2].map((v) => ({
    id: `ver_${slugify(origin)}_${v}`,
    siteId: id,
    runId: null,
    version: v,
    r2Key: `${origin}/llms.txt/v${v}`,
    changeSummary: v === 1 ? "initial generation" : "1 page added, 1 page modified",
    createdAt: now - (3 - v) * 7 * DAY_MS,
  }));
  const record: MockSite = {
    site: {
      id,
      domain: origin,
      displayName: titleCase(origin),
      monitoring: 0,
      checkIntervalS: 21600,
      nextCheckAt: null,
      changeStreak: 0,
      createdAt: now - 14 * DAY_MS,
    },
    versions: seeded,
    contents: new Map([
      [1, makeLlmsTxt(origin, 1)],
      [2, makeLlmsTxt(origin, 2)],
    ]),
    pages: makePages(origin),
  };
  sites.set(id, record);
  sitesByOrigin.set(origin, id);
  return record;
}

function latestVersion(record: MockSite): FileVersion | null {
  return record.versions.length ? record.versions[record.versions.length - 1] : null;
}

/** Publish the run's version once its timeline reaches "done". */
function settleRun(mockRun: MockRun): void {
  const record = sites.get(mockRun.siteId)!;
  if (record.versions.some((v) => v.version === mockRun.publishesVersion)) return;
  record.contents.set(mockRun.publishesVersion, makeLlmsTxt(record.site.domain, 3));
  record.versions.push({
    id: `ver_${slugify(record.site.domain)}_${mockRun.publishesVersion}`,
    siteId: record.site.id,
    runId: mockRun.runId,
    version: mockRun.publishesVersion,
    r2Key: `${record.site.domain}/llms.txt/v${mockRun.publishesVersion}`,
    changeSummary: "1 page added, 2 pages modified",
    createdAt: Date.now(),
  });
}

function buildRun(mockRun: MockRun): JobStatusResponse {
  const elapsed = Date.now() - mockRun.startedAt;
  const t = MOCK_TIMELINE;

  let status: Run["status"];
  let phase: "discovering" | "crawling" | "generating" | "done" | "error";
  if (mockRun.shouldFail && elapsed >= t.errorAt) {
    status = "error";
    phase = "error";
  } else if (elapsed < t.queuedUntil) {
    status = "queued";
    phase = "discovering";
  } else if (elapsed < t.crawlingUntil) {
    status = "crawling";
    phase = "crawling";
  } else if (elapsed < t.generatingUntil) {
    status = "generating";
    phase = "generating";
  } else {
    status = "done";
    phase = "done";
  }

  const crawlSpan = t.crawlingUntil - t.queuedUntil;
  const crawled =
    elapsed < t.queuedUntil
      ? 0
      : Math.min(t.pagesFound, Math.round(((elapsed - t.queuedUntil) / crawlSpan) * t.pagesFound));
  const found = elapsed < t.queuedUntil ? 0 : t.pagesFound;

  if (status === "done") settleRun(mockRun);

  const run: Run = {
    id: mockRun.runId,
    siteId: mockRun.siteId,
    trigger: "manual",
    status,
    pagesFound: found,
    pagesCrawled: status === "done" ? t.pagesFound : crawled,
    pagesChanged: status === "done" ? 3 : 0,
    discoveryMethod: elapsed >= t.queuedUntil ? "sitemap" : null,
    error: status === "error" ? "fetch_failed: could not reach the site (connection refused)" : null,
    startedAt: mockRun.startedAt,
    finishedAt: status === "done" || status === "error" ? mockRun.startedAt + t.generatingUntil : null,
  };

  if (status === "done" || status === "error") return { run };
  return {
    run,
    live: {
      runId: mockRun.runId,
      phase,
      pagesFound: found,
      pagesCrawled: crawled,
      discoveryMethod: elapsed >= t.queuedUntil ? "sitemap" : null,
      frontierSize: Math.max(0, found - crawled),
      inFlight: status === "crawling" ? Math.min(4, Math.max(0, found - crawled)) : 0,
    },
  };
}

function parseOrigin(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new ApiRequestError(400, "invalid_url: enter a full website address");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiRequestError(400, "invalid_url: enter a full website address");
  }
  return `${parsed.protocol}//${parsed.hostname.toLowerCase()}`;
}

export const mockClient: LlmsApi = {
  async createSite(url) {
    const origin = parseOrigin(url);
    const record = ensureSite(origin);
    runCounter += 1;
    const runId = `run_${slugify(origin)}_${runCounter}`;
    const latest = latestVersion(record);
    runs.set(runId, {
      runId,
      siteId: record.site.id,
      startedAt: Date.now(),
      shouldFail: hostnameFromOrigin(origin).includes("error"),
      publishesVersion: (latest?.version ?? 0) + 1,
    });
    return { siteId: record.site.id, runId };
  },

  async getSite(siteId) {
    const record = sites.get(siteId);
    if (!record) throw new ApiRequestError(404, "site_not_found");
    return { site: { ...record.site }, latestVersion: latestVersion(record) };
  },

  async getJob(runId) {
    const mockRun = runs.get(runId);
    if (!mockRun) throw new ApiRequestError(404, "run_not_found");
    return buildRun(mockRun);
  },

  async getVersions(siteId) {
    const record = sites.get(siteId);
    if (!record) throw new ApiRequestError(404, "site_not_found");
    return { versions: [...record.versions].sort((a, b) => b.version - a.version) };
  },

  async getPages(siteId) {
    const record = sites.get(siteId);
    if (!record) throw new ApiRequestError(404, "site_not_found");
    return { pages: record.pages };
  },

  async getDiff(siteId, from, to) {
    const record = sites.get(siteId);
    if (!record) throw new ApiRequestError(404, "site_not_found");
    const a = record.contents.get(from);
    const b = record.contents.get(to);
    if (a === undefined || b === undefined) throw new ApiRequestError(404, "version_not_found");
    return { from, to, diff: unifiedDiff(a, b, `llms.txt v${from}`, `llms.txt v${to}`) };
  },

  async setMonitoring(siteId, enabled) {
    const record = sites.get(siteId);
    if (!record) throw new ApiRequestError(404, "site_not_found");
    record.site.monitoring = enabled ? 1 : 0;
    record.site.nextCheckAt = enabled ? Date.now() + record.site.checkIntervalS * 1000 : null;
    return { site: { ...record.site }, latestVersion: latestVersion(record) };
  },

  async getLlmsTxt(origin) {
    const id = sitesByOrigin.get(origin);
    const record = id ? sites.get(id) : undefined;
    const latest = record ? latestVersion(record) : null;
    if (!record || !latest) throw new ApiRequestError(404, "file_not_found");
    return record.contents.get(latest.version) ?? makeLlmsTxt(origin, latest.version);
  },
};

/** Test helper: wipe all simulated state. */
export function resetMockState(): void {
  sites.clear();
  sitesByOrigin.clear();
  runs.clear();
  runCounter = 0;
}
