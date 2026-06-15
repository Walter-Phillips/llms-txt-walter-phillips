-- Store lightweight page freshness state for conditional recrawls.
-- Existing rows have no cached links/check timestamps yet, so link-discovery
-- crawls keep doing full fetches until a fresh HTML response populates them.

ALTER TABLE pages ADD COLUMN out_links_json TEXT;
ALTER TABLE pages ADD COLUMN last_checked_at INTEGER;
ALTER TABLE pages ADD COLUMN last_changed_at INTEGER;
ALTER TABLE pages ADD COLUMN page_check_interval_s INTEGER NOT NULL DEFAULT 604800;
ALTER TABLE pages ADD COLUMN page_change_streak INTEGER NOT NULL DEFAULT 0;
