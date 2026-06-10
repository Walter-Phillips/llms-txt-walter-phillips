-- Carry the monitor's human-readable change summary ("2 pages added, 1 modified")
-- through the crawl run so generation can stamp it on the new file version.

ALTER TABLE crawl_runs ADD COLUMN change_summary TEXT;
