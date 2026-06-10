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
const sitesByDomain = new Map<string, string>();
const runs = new Map<string, MockRun>();
let runCounter = 0;

function slugify(domain: string): string {
  return domain.replace(/[^a-z0-9]+/gi, "-");
}

function titleCase(domain: string): string {
  const name = domain.replace(/^www\./, "").split(".")[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function makeLlmsTxt(domain: string, version: number): string {
  const name = titleCase(domain);
  const base = `https://${domain}`;
  const lines = [
    `# ${name}`,
    "",
    `> ${name} builds developer tooling. This file lists the canonical pages of ${domain} for language models.`,
    "",
    `${name} publishes product pages, documentation, and a changelog. URLs below are stable and crawlable.`,
    "",
    "## Docs",
    "",
    `- [Quickstart](${base}/docs/quickstart): Install, configure, and ship in five minutes`,
    `- [API reference](${base}/docs/api): Complete endpoint and type reference`,
    version >= 2
      ? `- [Authentication](${base}/docs/auth): Token issuance, scopes, and rotation`
      : null,
    `- [Self-hosting](${base}/docs/self-hosting): Run the platform on your own infrastructure`,
    "",
    "## Product",
    "",
    `- [Pricing](${base}/pricing): Plans, limits, and overage policy`,
    `- [Integrations](${base}/integrations): First-party connectors and webhooks`,
    version >= 3 ? `- [Changelog](${base}/changelog): Dated release notes, newest first` : null,
    "",
    "## Optional",
    "",
    `- [Blog](${base}/blog): Engineering notes and release deep-dives`,
    `- [About](${base}/about): Company, team, and contact details`,
  ].filter((l): l is string => l !== null);
  return lines.join("\n") + "\n";
}

function makePages(domain: string): PageInventoryItem[] {
  const base = `https://${domain}`;
  return [
    { url: `${base}/`, title: `${titleCase(domain)} — Home`, description: "Landing page", sectionHint: null, status: "ok" },
    { url: `${base}/docs/quickstart`, title: "Quickstart", description: "Install and ship in five minutes", sectionHint: "Docs", status: "ok" },
    { url: `${base}/docs/api`, title: "API reference", description: "Endpoints and types", sectionHint: "Docs", status: "ok" },
    { url: `${base}/docs/auth`, title: "Authentication", description: "Tokens, scopes, rotation", sectionHint: "Docs", status: "ok" },
    { url: `${base}/docs/self-hosting`, title: "Self-hosting", description: "Run on your own infra", sectionHint: "Docs", status: "ok" },
    { url: `${base}/pricing`, title: "Pricing", description: "Plans and limits", sectionHint: "Product", status: "ok" },
    { url: `${base}/integrations`, title: "Integrations", description: "Connectors and webhooks", sectionHint: "Product", status: "ok" },
    { url: `${base}/changelog`, title: "Changelog", description: "Release notes", sectionHint: "Product", status: "ok" },
    { url: `${base}/blog`, title: "Blog", description: "Engineering notes", sectionHint: "Optional", status: "ok" },
    { url: `${base}/about`, title: "About", description: "Company and contact", sectionHint: "Optional", status: "ok" },
    { url: `${base}/admin`, title: null, description: null, sectionHint: null, status: "skipped" },
    { url: `${base}/search`, title: "Search", description: null, sectionHint: null, status: "excluded" },
  ];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function ensureSite(domain: string): MockSite {
  const existingId = sitesByDomain.get(domain);
  if (existingId) return sites.get(existingId)!;

  const id = `site_${slugify(domain)}`;
  const now = Date.now();
  // Seed two backdated versions so history + diffs are demoable on the very
  // first run (mock-only behavior; the real API starts at version 1).
  const seeded: FileVersion[] = [1, 2].map((v) => ({
    id: `ver_${slugify(domain)}_${v}`,
    siteId: id,
    runId: null,
    version: v,
    r2Key: `${domain}/llms.txt/v${v}`,
    changeSummary: v === 1 ? "initial generation" : "1 page added, 1 page modified",
    createdAt: now - (3 - v) * 7 * DAY_MS,
  }));
  const record: MockSite = {
    site: {
      id,
      domain,
      displayName: titleCase(domain),
      monitoring: 0,
      checkIntervalS: 21600,
      nextCheckAt: null,
      changeStreak: 0,
      createdAt: now - 14 * DAY_MS,
    },
    versions: seeded,
    contents: new Map([
      [1, makeLlmsTxt(domain, 1)],
      [2, makeLlmsTxt(domain, 2)],
    ]),
    pages: makePages(domain),
  };
  sites.set(id, record);
  sitesByDomain.set(domain, id);
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

function parseDomain(url: string): string {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ApiRequestError(400, "invalid_url: enter a full website address");
  }
  if (!parsed.hostname.includes(".")) {
    throw new ApiRequestError(400, "invalid_url: enter a full website address");
  }
  return parsed.hostname.toLowerCase();
}

export const mockClient: LlmsApi = {
  async createSite(url) {
    const domain = parseDomain(url);
    const record = ensureSite(domain);
    runCounter += 1;
    const runId = `run_${slugify(domain)}_${runCounter}`;
    const latest = latestVersion(record);
    runs.set(runId, {
      runId,
      siteId: record.site.id,
      startedAt: Date.now(),
      shouldFail: domain.includes("error"),
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

  async getLlmsTxt(domain) {
    const id = sitesByDomain.get(domain);
    const record = id ? sites.get(id) : undefined;
    const latest = record ? latestVersion(record) : null;
    if (!record || !latest) throw new ApiRequestError(404, "file_not_found");
    return record.contents.get(latest.version) ?? makeLlmsTxt(domain, latest.version);
  },
};

/** Test helper: wipe all simulated state. */
export function resetMockState(): void {
  sites.clear();
  sitesByDomain.clear();
  runs.clear();
  runCounter = 0;
}
