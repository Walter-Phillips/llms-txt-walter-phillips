import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { crawlRuns, pages } from "@profound-takehome/db";
import type { CrawlMessage } from "../bindings";
import type { ClaimRequest } from "../do/site-coordinator";
import type { SitemapEntry } from "../crawler/sitemap";
import { applyCadencePrior } from "./crawl-discovery";

type Database = ReturnType<typeof drizzle>;
type DiscoverMessage = Extract<CrawlMessage, { type: "discover" }>;

interface AcceptedUrl {
  url: string;
  depth: number;
}

/**
 * Claim the site coordinator for a discovery run.
 * @param input Discovery claim context.
 * @param input.db Database client.
 * @param input.stub Site coordinator stub.
 * @param input.message Discover message.
 * @param input.now Current epoch second.
 * @param input.origin Entered site origin.
 * @param input.disallow Robots disallow rules.
 * @param input.discoveryMethod Selected discovery mode.
 * @param input.useSitemap Whether sitemap discovery is active.
 * @returns Whether the claim succeeded and the run should continue.
 */
export async function claimDiscovery(input: {
  db: Database;
  stub: DurableObjectStub;
  message: DiscoverMessage;
  now: number;
  origin: string;
  disallow: string[];
  discoveryMethod: string;
  useSitemap: boolean;
}): Promise<boolean> {
  const claim = await input.stub.fetch("https://do/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId: input.message.runId,
      origin: input.origin,
      disallow: input.disallow,
      discoveryMethod: input.discoveryMethod,
      followLinks: !input.useSitemap,
    } satisfies ClaimRequest),
  });
  if (claim.status === 409) {
    await input.db
      .update(crawlRuns)
      .set({
        status: "error",
        error: "another run is in progress for this site",
        finishedAt: input.now,
      })
      .where(eq(crawlRuns.id, input.message.runId));
    return false;
  }
  if (!claim.ok) throw new Error(`DO claim → ${String(claim.status)}`);
  return true;
}

/**
 * Persist sitemap lastmod metadata for pages accepted into the frontier.
 * @param input Sitemap persistence context.
 * @param input.db Database client.
 * @param input.siteId Site receiving page rows.
 * @param input.entries Sitemap entries with optional lastmod values.
 * @param input.accepted Accepted frontier URLs.
 * @param input.now Current epoch second.
 */
export async function persistSitemapPages(input: {
  db: Database;
  siteId: string;
  entries: SitemapEntry[];
  accepted: AcceptedUrl[];
  now: number;
}): Promise<void> {
  const lastmodByUrl = new Map(input.entries.map((entry) => [entry.url, entry.lastmod ?? null]));
  const statements = input.accepted
    .filter(({ url }) => lastmodByUrl.get(url) !== undefined)
    .map(({ url }) =>
      input.db
        .insert(pages)
        .values({
          id: nanoid(12),
          siteId: input.siteId,
          url,
          sitemapLastmod: lastmodByUrl.get(url) ?? null,
          status: "active",
          lastSeenAt: input.now,
        })
        .onConflictDoUpdate({
          target: [pages.siteId, pages.url],
          set: { sitemapLastmod: lastmodByUrl.get(url) ?? null, status: "active" },
        }),
    );
  for (let index = 0; index < statements.length; index += 20) {
    const chunk = statements.slice(index, index + 20);
    await input.db.batch([chunk[0], ...chunk.slice(1)]);
  }
}

/**
 * Persist the crawl run's transition from queued discovery to crawling.
 * @param input Run update context.
 * @param input.db Database client.
 * @param input.message Discover message.
 * @param input.discoveryMethod Selected discovery mode.
 * @param input.accepted Accepted frontier URLs.
 * @param input.now Current epoch second.
 */
export async function markRunCrawling(input: {
  db: Database;
  message: DiscoverMessage;
  discoveryMethod: string;
  accepted: AcceptedUrl[];
  now: number;
}): Promise<void> {
  await input.db
    .update(crawlRuns)
    .set({
      status: "crawling",
      discoveryMethod: input.discoveryMethod,
      pagesFound: input.accepted.length,
      startedAt: input.now,
    })
    .where(eq(crawlRuns.id, input.message.runId));
}

/**
 * Apply the initial monitor cadence prior after discovery seeding.
 * @param input Cadence update context.
 * @param input.db Database client.
 * @param input.message Discover message.
 * @param input.accepted Accepted frontier URLs.
 * @param input.isNewsSitemap Whether the selected sitemap was a news sitemap.
 */
export async function applyDiscoveryCadence(input: {
  db: Database;
  message: DiscoverMessage;
  accepted: AcceptedUrl[];
  isNewsSitemap: boolean;
}): Promise<void> {
  const run = await input.db
    .select({ trigger: crawlRuns.trigger })
    .from(crawlRuns)
    .where(eq(crawlRuns.id, input.message.runId))
    .get();
  await applyCadencePrior(input.db, input.message.siteId, run?.trigger, {
    urls: input.accepted.map((page) => page.url),
    pageCount: input.accepted.length,
    isNewsSitemap: input.isNewsSitemap,
  });
}

/**
 * Mark a discovery run as failed when no URLs entered the frontier.
 * @param db Database client.
 * @param stub Site coordinator stub.
 * @param runId Empty run identifier.
 * @param now Current epoch second.
 */
export async function finishEmptyRun(
  db: Database,
  stub: DurableObjectStub,
  runId: string,
  now: number,
): Promise<void> {
  await db
    .update(crawlRuns)
    .set({ status: "error", error: "no crawlable pages found", finishedAt: now })
    .where(eq(crawlRuns.id, runId));
  const response = await stub.fetch("https://do/finish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId, phase: "error" }),
  });
  if (!response.ok) {
    throw new Error(`DO /finish → ${String(response.status)}: ${await response.text()}`);
  }
}
