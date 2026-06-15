-- Initial schema. Drizzle owns this going forward (`pnpm --filter @profound-takehome/db generate`),
-- but the first migration is hand-written so wrangler d1 migrations apply works on a fresh DB.

CREATE TABLE sites (
  id                TEXT PRIMARY KEY,
  domain            TEXT NOT NULL,
  display_name      TEXT,
  monitoring        INTEGER NOT NULL DEFAULT 1,
  check_interval_s  INTEGER NOT NULL DEFAULT 86400,
  next_check_at     INTEGER,
  change_streak     INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL
);
CREATE UNIQUE INDEX sites_domain_idx ON sites(domain);
CREATE INDEX sites_due_idx ON sites(monitoring, next_check_at);

CREATE TABLE pages (
  id                TEXT PRIMARY KEY,
  site_id           TEXT NOT NULL REFERENCES sites(id),
  url               TEXT NOT NULL,
  title             TEXT,
  description       TEXT,
  h1                TEXT,
  snippet           TEXT,
  section_hint      TEXT,
  content_hash      TEXT,
  etag              TEXT,
  last_modified     TEXT,
  sitemap_lastmod   TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  last_seen_at      INTEGER
);
CREATE UNIQUE INDEX pages_site_url_idx ON pages(site_id, url);
CREATE INDEX pages_site_idx ON pages(site_id);

CREATE TABLE crawl_runs (
  id                TEXT PRIMARY KEY,
  site_id           TEXT NOT NULL REFERENCES sites(id),
  trigger           TEXT NOT NULL,
  status            TEXT NOT NULL,
  pages_found       INTEGER NOT NULL DEFAULT 0,
  pages_crawled     INTEGER NOT NULL DEFAULT 0,
  pages_changed     INTEGER NOT NULL DEFAULT 0,
  discovery_method  TEXT,
  error             TEXT,
  started_at        INTEGER,
  finished_at       INTEGER
);
CREATE INDEX runs_site_idx ON crawl_runs(site_id);

CREATE TABLE file_versions (
  id              TEXT PRIMARY KEY,
  site_id         TEXT NOT NULL REFERENCES sites(id),
  run_id          TEXT REFERENCES crawl_runs(id),
  version         INTEGER NOT NULL,
  r2_key          TEXT NOT NULL,
  change_summary  TEXT,
  created_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX versions_site_version_idx ON file_versions(site_id, version);
