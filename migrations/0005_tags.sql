CREATE TABLE IF NOT EXISTS tags (
  tag TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS document_tags (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL REFERENCES tags(tag),
  PRIMARY KEY (document_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_document_tags_tag ON document_tags(tag);
