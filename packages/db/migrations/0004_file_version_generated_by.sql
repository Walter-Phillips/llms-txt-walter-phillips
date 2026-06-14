-- Record which generation pass produced each published file version.
-- Existing versions stay NULL and are treated as unknown.

ALTER TABLE file_versions ADD COLUMN generated_by TEXT;
