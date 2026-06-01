-- Full-text search index for documents.
-- The filesystem remains source of truth; this table is rebuildable via reindex.

ALTER TABLE documents ADD COLUMN body_indexed TEXT NOT NULL DEFAULT '';

CREATE VIRTUAL TABLE documents_fts USING fts5(
  id UNINDEXED,
  project_id UNINDEXED,
  title,
  tags,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(id, project_id, title, tags, body)
  VALUES (new.id, new.project_id, new.title, new.tags, new.body_indexed);
END;

CREATE TRIGGER documents_ad AFTER DELETE ON documents BEGIN
  DELETE FROM documents_fts WHERE id = old.id;
END;

CREATE TRIGGER documents_au AFTER UPDATE ON documents BEGIN
  DELETE FROM documents_fts WHERE id = old.id;
  INSERT INTO documents_fts(id, project_id, title, tags, body)
  VALUES (new.id, new.project_id, new.title, new.tags, new.body_indexed);
END;
