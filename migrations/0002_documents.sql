-- Documents table (v2).
-- Filesystem remains source of truth; this table is an index.

CREATE TABLE IF NOT EXISTS documents (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  type       TEXT NOT NULL,
  status     TEXT NOT NULL,
  path       TEXT NOT NULL UNIQUE,
  tags       TEXT NOT NULL DEFAULT '[]', -- JSON-encoded string[]
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_type    ON documents(type);
