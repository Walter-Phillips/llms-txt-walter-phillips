-- Record whether a crawl stopped because the configured frontier budget was
-- exhausted. Existing runs stay NULL and are treated as uncapped/unknown.

ALTER TABLE crawl_runs ADD COLUMN cap_reason TEXT;
