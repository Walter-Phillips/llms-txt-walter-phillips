import { drizzle } from "drizzle-orm/d1";
import type { CrawlMessage, Environment } from "../bindings";
import { fetchRobots } from "../crawler/robots";
import { discoverSitemapEntries, type SitemapEntry } from "../crawler/sitemap";
import type { SeedRequest, SeedResponse } from "../do/site-coordinator";
import { logInfo } from "../observability/logger";
import { aliasSitemapEntries } from "./crawl-discovery";
import {
  applyDiscoveryCadence,
  claimDiscovery,
  finishEmptyRun,
  markRunCrawling,
  persistSitemapPages,
} from "./crawl-discover-handler";
import {
  coordinator,
  doCall,
  enqueuePages,
  failRunAfterEnqueueFailure,
  type Database,
} from "./crawl-queue-helpers";

const MIN_SITEMAP_URLS = 3;

type DiscoverMessage = Extract<CrawlMessage, { type: "discover" }>;
type AcceptedUrl = SeedResponse["accepted"][number];

interface DiscoveryCandidates {
  discoveryMethod: string;
  disallow: string[];
  entries: SitemapEntry[];
  sitemapIsNews: boolean;
  useSitemap: boolean;
}

async function loadDiscoveryCandidates(origin: string): Promise<DiscoveryCandidates> {
  const robots = await fetchRobots(origin);
  const sitemap = await discoverSitemapEntries(origin, robots.sitemaps);
  const entries = aliasSitemapEntries(sitemap.entries, origin);
  const useSitemap = entries.length >= MIN_SITEMAP_URLS;

  return {
    discoveryMethod: useSitemap ? "sitemap" : "links",
    disallow: robots.disallow,
    entries,
    sitemapIsNews: sitemap.isNews,
    useSitemap,
  };
}

async function seedFrontier(input: {
  stub: DurableObjectStub;
  message: DiscoverMessage;
  origin: string;
  useSitemap: boolean;
  entries: { url: string }[];
}): Promise<SeedResponse> {
  const candidates = input.useSitemap
    ? input.entries.map((entry) => entry.url)
    : [`${input.origin}/`];
  return await doCall<SeedResponse>(input.stub, "/seed", {
    runId: input.message.runId,
    urls: candidates,
    baseUrl: input.origin,
    depth: 0,
  } satisfies SeedRequest);
}

async function enqueueSeededPages(input: {
  db: Database;
  env: Environment;
  stub: DurableObjectStub;
  message: DiscoverMessage;
  accepted: AcceptedUrl[];
  followLinks: boolean;
}): Promise<void> {
  try {
    await enqueuePages({
      env: input.env,
      runId: input.message.runId,
      siteId: input.message.siteId,
      urls: input.accepted,
      followLinks: input.followLinks,
    });
  } catch (error) {
    await failRunAfterEnqueueFailure({
      db: input.db,
      stub: input.stub,
      runId: input.message.runId,
      context: "seed pages",
      error,
    });
  }
}

function logDiscoverySkipped(message: DiscoverMessage, origin: string): void {
  logInfo("crawl_discovery_skipped", {
    workflow: "crawl",
    step: "discovery",
    outcome: "skipped",
    siteId: message.siteId,
    runId: message.runId,
    domain: origin,
  });
}

function logDiscoveryCompleted(input: {
  message: DiscoverMessage;
  origin: string;
  discoveryMethod: string;
  sitemapEntryCount: number;
  acceptedCount: number;
}): void {
  logInfo("crawl_discovery_completed", {
    workflow: "crawl",
    step: "discovery",
    outcome: "completed",
    siteId: input.message.siteId,
    runId: input.message.runId,
    domain: input.origin,
    discoveryMethod: input.discoveryMethod,
    sitemapEntryCount: input.sitemapEntryCount,
    acceptedCount: input.acceptedCount,
  });
}

async function persistDiscoveryState(input: {
  db: Database;
  message: DiscoverMessage;
  discoveryMethod: string;
  accepted: AcceptedUrl[];
  now: number;
  useSitemap: boolean;
  entries: SitemapEntry[];
  sitemapIsNews: boolean;
}): Promise<void> {
  if (input.useSitemap) {
    await persistSitemapPages({
      db: input.db,
      siteId: input.message.siteId,
      entries: input.entries,
      accepted: input.accepted,
      now: input.now,
    });
  }

  await markRunCrawling({
    db: input.db,
    message: input.message,
    discoveryMethod: input.discoveryMethod,
    accepted: input.accepted,
    now: input.now,
  });

  await applyDiscoveryCadence({
    db: input.db,
    message: input.message,
    accepted: input.accepted,
    isNewsSitemap: input.useSitemap && input.sitemapIsNews,
    now: input.now,
  });
}

async function finishSeededDiscovery(input: {
  db: Database;
  env: Environment;
  stub: DurableObjectStub;
  message: DiscoverMessage;
  origin: string;
  discovery: DiscoveryCandidates;
  seeded: SeedResponse;
  now: number;
}): Promise<void> {
  await persistDiscoveryState({
    db: input.db,
    message: input.message,
    discoveryMethod: input.discovery.discoveryMethod,
    accepted: input.seeded.accepted,
    now: input.now,
    useSitemap: input.discovery.useSitemap,
    entries: input.discovery.entries,
    sitemapIsNews: input.discovery.sitemapIsNews,
  });
  logDiscoveryCompleted({
    message: input.message,
    origin: input.origin,
    discoveryMethod: input.discovery.discoveryMethod,
    sitemapEntryCount: input.discovery.entries.length,
    acceptedCount: input.seeded.accepted.length,
  });

  if (input.seeded.accepted.length === 0) {
    await finishEmptyRun(input.db, input.stub, input.message.runId, input.now);
    return;
  }

  await enqueueSeededPages({
    db: input.db,
    env: input.env,
    stub: input.stub,
    message: input.message,
    accepted: input.seeded.accepted,
    followLinks: !input.discovery.useSitemap,
  });
}

/**
 * Handles crawl discovery by claiming the run, seeding the frontier, and
 * enqueueing accepted URLs.
 * @param env Worker bindings.
 * @param message Discovery queue message.
 */
export async function handleDiscover(env: Environment, message: DiscoverMessage): Promise<void> {
  const db = drizzle(env.DB);
  const now = Math.floor(Date.now() / 1000);
  const origin = message.url;
  const discovery = await loadDiscoveryCandidates(origin);
  const stub = coordinator(env, message.siteId);
  const claimed = await claimDiscovery({
    db,
    stub,
    message,
    now,
    origin,
    disallow: discovery.disallow,
    discoveryMethod: discovery.discoveryMethod,
    useSitemap: discovery.useSitemap,
  });
  if (!claimed) {
    logDiscoverySkipped(message, origin);
    return;
  }

  const seeded = await seedFrontier({
    stub,
    message,
    origin,
    useSitemap: discovery.useSitemap,
    entries: discovery.entries,
  });

  await finishSeededDiscovery({
    db,
    env,
    stub,
    message,
    origin,
    discovery,
    seeded,
    now,
  });
}
