import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const sites = sqliteTable(
  "sites",
  {
    id: text("id").primaryKey(),
    domain: text("domain").notNull(),
    displayName: text("display_name"),
    monitoring: integer("monitoring").notNull().default(0),
    checkIntervalS: integer("check_interval_s").notNull().default(86400),
    nextCheckAt: integer("next_check_at"),
    changeStreak: integer("change_streak").notNull().default(0),
    createdAt: integer("created_at").notNull()
  },
  (t) => ({
    domainIdx: uniqueIndex("sites_domain_idx").on(t.domain),
    dueIdx: index("sites_due_idx").on(t.monitoring, t.nextCheckAt)
  })
);

export const pages = sqliteTable(
  "pages",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    url: text("url").notNull(),
    title: text("title"),
    description: text("description"),
    h1: text("h1"),
    snippet: text("snippet"),
    sectionHint: text("section_hint"),
    contentHash: text("content_hash"),
    etag: text("etag"),
    lastModified: text("last_modified"),
    sitemapLastmod: text("sitemap_lastmod"),
    status: text("status").notNull().default("active"),
    lastSeenAt: integer("last_seen_at")
  },
  (t) => ({
    siteUrlIdx: uniqueIndex("pages_site_url_idx").on(t.siteId, t.url),
    siteIdx: index("pages_site_idx").on(t.siteId),
    siteStatusIdx: index("pages_site_status_idx").on(t.siteId, t.status)
  })
);

export const crawlRuns = sqliteTable(
  "crawl_runs",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    trigger: text("trigger").notNull(),
    status: text("status").notNull(),
    pagesFound: integer("pages_found").notNull().default(0),
    pagesCrawled: integer("pages_crawled").notNull().default(0),
    pagesChanged: integer("pages_changed").notNull().default(0),
    changeSummary: text("change_summary"),
    discoveryMethod: text("discovery_method"),
    capReason: text("cap_reason"),
    error: text("error"),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at")
  },
  (t) => ({
    siteIdx: index("runs_site_idx").on(t.siteId)
  })
);

export const fileVersions = sqliteTable(
  "file_versions",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    runId: text("run_id").references(() => crawlRuns.id),
    version: integer("version").notNull(),
    r2Key: text("r2_key").notNull(),
    changeSummary: text("change_summary"),
    generatedBy: text("generated_by"),
    createdAt: integer("created_at").notNull()
  },
  (t) => ({
    siteVersionIdx: uniqueIndex("versions_site_version_idx").on(t.siteId, t.version)
  })
);
