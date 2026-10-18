-- Opaque document revision: a fingerprint of the persisted content (the .md
-- file, plus the sidecar entry for sidecar-backed documents). Used as the
-- If-Match token; `updated_at` stays for display only. Rows indexed before
-- this migration get their revision on the next (startup) reindex.
ALTER TABLE documents ADD COLUMN revision TEXT NOT NULL DEFAULT '';
