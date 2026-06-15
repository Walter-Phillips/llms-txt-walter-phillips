import type {
  CreateSiteResponse,
  DiffResponse,
  FileVersion,
  GeneratedSitesResponse,
  JobStatusResponse,
  PagesResponse,
  PageInventoryItem,
  Run,
  Site,
  SiteResponse,
  VersionsResponse,
} from "@profound-takehome/shared";
import { ApiRequestError, type LlmsApi } from "./api";
import { unifiedDiff } from "./diff";
import { hostnameFromOrigin, makeLlmsTxt, makePages, titleCase } from "./mock-site-fixtures";

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

const DEFAULT_GENERATED_ORIGINS = [
  "https://vercel.com",
  "https://stripe.com",
  "https://hono.dev",
] as const;

function slugify(origin: string): string {
  return hostnameFromOrigin(origin).replace(/[^a-z0-9]+/gi, "-");
}

const DAY_MS = 24 * 60 * 60 * 1000;

function ensureSite(origin: string): MockSite {
  const existingId = sitesByOrigin.get(origin);
  if (existingId) {
    const existing = sites.get(existingId);
    if (existing) return existing;
  }

  const id = `site_${slugify(origin)}`;
  const now = Date.now();
  const seeded: FileVersion[] = [1, 2].map((v) => ({
    id: `ver_${slugify(origin)}_${String(v)}`,
    siteId: id,
    runId: null,
    version: v,
    r2Key: `${origin}/llms.txt/v${String(v)}`,
    changeSummary: v === 1 ? "initial generation" : "1 page added, 1 page modified",
    createdAt: now - (3 - v) * 7 * DAY_MS,
  }));
  const record: MockSite = {
    site: {
      id,
      domain: origin,
      displayName: titleCase(origin),
      monitoring: 1,
      checkIntervalS: 21600,
      nextCheckAt: now + 21600 * 1000,
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

/**
 * Publish the run's version once its timeline reaches "done".
 * @param mockRun Simulated run that just reached a terminal success state.
 * @throws ApiRequestError when the run references an unknown site.
 */
function settleRun(mockRun: MockRun): void {
  const record = sites.get(mockRun.siteId);
  if (!record) throw new ApiRequestError(404, "site_not_found");
  if (record.versions.some((v) => v.version === mockRun.publishesVersion)) return;
  record.contents.set(mockRun.publishesVersion, makeLlmsTxt(record.site.domain, 3));
  record.versions.push({
    id: `ver_${slugify(record.site.domain)}_${String(mockRun.publishesVersion)}`,
    siteId: record.site.id,
    runId: mockRun.runId,
    version: mockRun.publishesVersion,
    r2Key: `${record.site.domain}/llms.txt/v${String(mockRun.publishesVersion)}`,
    changeSummary: "1 page added, 2 pages modified",
    createdAt: Date.now(),
  });
}

type MockPhase = "discovering" | "crawling" | "generating" | "done" | "error";

interface RunStage {
  status: Run["status"];
  phase: MockPhase;
}

interface CrawlProgress {
  found: number;
  crawled: number;
  discoveryMethod: string | null;
}

type LiveStatus = NonNullable<JobStatusResponse["live"]>;

function runStage(mockRun: MockRun, elapsed: number): RunStage {
  const t = MOCK_TIMELINE;
  if (mockRun.shouldFail && elapsed >= t.errorAt) {
    return { status: "error", phase: "error" };
  }
  if (elapsed < t.queuedUntil) return { status: "queued", phase: "discovering" };
  if (elapsed < t.crawlingUntil) return { status: "crawling", phase: "crawling" };
  if (elapsed < t.generatingUntil) return { status: "generating", phase: "generating" };
  return { status: "done", phase: "done" };
}

function crawlProgress(elapsed: number): CrawlProgress {
  const t = MOCK_TIMELINE;
  const hasStarted = elapsed >= t.queuedUntil;
  const crawlSpan = t.crawlingUntil - t.queuedUntil;
  const crawled = hasStarted
    ? Math.min(t.pagesFound, Math.round(((elapsed - t.queuedUntil) / crawlSpan) * t.pagesFound))
    : 0;
  return {
    found: hasStarted ? t.pagesFound : 0,
    crawled,
    discoveryMethod: hasStarted ? "sitemap" : null,
  };
}

function isTerminalStatus(status: Run["status"]): boolean {
  return status === "done" || status === "error";
}

function makeRun(mockRun: MockRun, status: Run["status"], progress: CrawlProgress): Run {
  const t = MOCK_TIMELINE;
  return {
    id: mockRun.runId,
    siteId: mockRun.siteId,
    trigger: "manual",
    status,
    pagesFound: progress.found,
    pagesCrawled: status === "done" ? t.pagesFound : progress.crawled,
    pagesChanged: status === "done" ? 3 : 0,
    discoveryMethod: progress.discoveryMethod,
    error:
      status === "error" ? "fetch_failed: could not reach the site (connection refused)" : null,
    startedAt: mockRun.startedAt,
    finishedAt:
      status === "done" || status === "error" ? mockRun.startedAt + t.generatingUntil : null,
  };
}

function makeLive(mockRun: MockRun, stage: RunStage, progress: CrawlProgress): LiveStatus {
  const remaining = Math.max(0, progress.found - progress.crawled);
  return {
    runId: mockRun.runId,
    phase: stage.phase,
    pagesFound: progress.found,
    pagesCrawled: progress.crawled,
    discoveryMethod: progress.discoveryMethod,
    frontierSize: remaining,
    inFlight: stage.status === "crawling" ? Math.min(4, remaining) : 0,
  };
}

function buildRun(mockRun: MockRun): JobStatusResponse {
  const elapsed = Date.now() - mockRun.startedAt;
  const stage = runStage(mockRun, elapsed);
  const progress = crawlProgress(elapsed);

  if (stage.status === "done") settleRun(mockRun);

  const run = makeRun(mockRun, stage.status, progress);
  if (isTerminalStatus(stage.status)) return { run };
  return { run, live: makeLive(mockRun, stage, progress) };
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

function createSite(url: string): CreateSiteResponse {
  const origin = parseOrigin(url);
  const record = ensureSite(origin);
  if (record.site.monitoring !== 1) setMonitoring(record.site.id, true);
  runCounter += 1;
  const runId = `run_${slugify(origin)}_${String(runCounter)}`;
  runs.set(runId, {
    runId,
    siteId: record.site.id,
    startedAt: Date.now(),
    shouldFail: hostnameFromOrigin(origin).includes("error"),
    publishesVersion: (latestVersion(record)?.version ?? 0) + 1,
  });
  return { siteId: record.site.id, runId };
}

function getGeneratedSites(query?: string): GeneratedSitesResponse {
  if (sites.size === 0) {
    for (const origin of DEFAULT_GENERATED_ORIGINS) ensureSite(origin);
  }

  const needle = query?.trim().toLowerCase() ?? "";
  const generated = [...sites.values()]
    .map((record) => {
      const latest = latestVersion(record);
      return latest ? { site: { ...record.site }, latestVersion: latest } : null;
    })
    .filter((record): record is GeneratedSitesResponse["sites"][number] => record !== null)
    .filter((record) => record.site.domain.toLowerCase().includes(needle))
    .sort((a, b) => b.latestVersion.createdAt - a.latestVersion.createdAt);

  return { sites: generated };
}

function getSite(siteId: string): SiteResponse {
  const record = sites.get(siteId);
  if (!record) throw new ApiRequestError(404, "site_not_found");
  return { site: { ...record.site }, latestVersion: latestVersion(record) };
}

function getJob(runId: string): JobStatusResponse {
  const mockRun = runs.get(runId);
  if (!mockRun) throw new ApiRequestError(404, "run_not_found");
  return buildRun(mockRun);
}

function getVersions(siteId: string): VersionsResponse {
  const record = sites.get(siteId);
  if (!record) throw new ApiRequestError(404, "site_not_found");
  return { versions: [...record.versions].sort((a, b) => b.version - a.version) };
}

function getPages(siteId: string): PagesResponse {
  const record = sites.get(siteId);
  if (!record) throw new ApiRequestError(404, "site_not_found");
  return { pages: record.pages };
}

function getDiff(siteId: string, from: number, to: number): DiffResponse {
  const record = sites.get(siteId);
  if (!record) throw new ApiRequestError(404, "site_not_found");
  const a = record.contents.get(from);
  const b = record.contents.get(to);
  if (a === undefined || b === undefined) throw new ApiRequestError(404, "version_not_found");
  return {
    from,
    to,
    diff: unifiedDiff(a, b, `llms.txt v${String(from)}`, `llms.txt v${String(to)}`),
  };
}

function setMonitoring(siteId: string, enabled: boolean): SiteResponse {
  const record = sites.get(siteId);
  if (!record) throw new ApiRequestError(404, "site_not_found");
  record.site.monitoring = enabled ? 1 : 0;
  record.site.nextCheckAt = enabled ? Date.now() + record.site.checkIntervalS * 1000 : null;
  return { site: { ...record.site }, latestVersion: latestVersion(record) };
}

function getLlmsTxt(origin: string): string {
  const id = sitesByOrigin.get(origin);
  const record = id ? sites.get(id) : undefined;
  const latest = record ? latestVersion(record) : null;
  if (!record || !latest) throw new ApiRequestError(404, "file_not_found");
  return record.contents.get(latest.version) ?? makeLlmsTxt(origin, latest.version);
}

function resolveMock<T>(callback: () => T): Promise<T> {
  return Promise.resolve().then(callback);
}

export const mockClient = {
  createSite: (url) => resolveMock(() => createSite(url)),
  getGeneratedSites: (query) => resolveMock(() => getGeneratedSites(query)),
  getSite: (siteId) => resolveMock(() => getSite(siteId)),
  getJob: (runId) => resolveMock(() => getJob(runId)),
  getVersions: (siteId) => resolveMock(() => getVersions(siteId)),
  getPages: (siteId) => resolveMock(() => getPages(siteId)),
  getDiff: (siteId, from, to) => resolveMock(() => getDiff(siteId, from, to)),
  setMonitoring: (siteId, enabled) => resolveMock(() => setMonitoring(siteId, enabled)),
  getLlmsTxt: (origin) => resolveMock(() => getLlmsTxt(origin)),
} satisfies LlmsApi;

/** Test helper: wipe all simulated state. */
export function resetMockState(): void {
  sites.clear();
  sitesByOrigin.clear();
  runs.clear();
  runCounter = 0;
}
