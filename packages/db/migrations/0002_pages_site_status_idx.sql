-- Speed up the hot (site_id, status='active') filters used by the generator
-- and monitor. Without this, only site_id is indexed, forcing an in-memory
-- status filter over all of a site's pages.

CREATE INDEX pages_site_status_idx ON pages(site_id, status);
