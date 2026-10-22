-- Shared full-text projection for grouped task/comment search (spec #58).
-- One row per searchable record: a document (title, tags, body) or a comment
-- (body only). Keeping both kinds in one FTS5 table lets bm25 rank them
-- against the same statistics, so a task's strongest record can be picked
-- without comparing scores from separate indexes. `document_id` is the
-- document itself or, for a comment, its parent task. Derived like
-- documents_fts was: rebuilt by triggers from the documents and comments
-- tables, which Reload and Reindex rebuild from Markdown.

DROP TRIGGER documents_ai;
DROP TRIGGER documents_ad;
DROP TRIGGER documents_au;
DROP TABLE documents_fts;

CREATE VIRTUAL TABLE search_fts USING fts5(
  record_id UNINDEXED,
  kind UNINDEXED,
  document_id UNINDEXED,
  title,
  tags,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO search_fts(record_id, kind, document_id, title, tags, body)
  SELECT id, 'document', id, title, tags, body_indexed FROM documents;
INSERT INTO search_fts(record_id, kind, document_id, title, tags, body)
  SELECT id, 'comment', task_id, '', '', body FROM comments;

CREATE TRIGGER documents_search_ai AFTER INSERT ON documents BEGIN
  INSERT INTO search_fts(record_id, kind, document_id, title, tags, body)
  VALUES (new.id, 'document', new.id, new.title, new.tags, new.body_indexed);
END;

CREATE TRIGGER documents_search_ad AFTER DELETE ON documents BEGIN
  DELETE FROM search_fts WHERE record_id = old.id AND kind = 'document';
END;

CREATE TRIGGER documents_search_au AFTER UPDATE ON documents BEGIN
  DELETE FROM search_fts WHERE record_id = old.id AND kind = 'document';
  INSERT INTO search_fts(record_id, kind, document_id, title, tags, body)
  VALUES (new.id, 'document', new.id, new.title, new.tags, new.body_indexed);
END;

CREATE TRIGGER comments_search_ai AFTER INSERT ON comments BEGIN
  INSERT INTO search_fts(record_id, kind, document_id, title, tags, body)
  VALUES (new.id, 'comment', new.task_id, '', '', new.body);
END;

CREATE TRIGGER comments_search_ad AFTER DELETE ON comments BEGIN
  DELETE FROM search_fts WHERE record_id = old.id AND kind = 'comment';
END;

CREATE TRIGGER comments_search_au AFTER UPDATE ON comments BEGIN
  DELETE FROM search_fts WHERE record_id = old.id AND kind = 'comment';
  INSERT INTO search_fts(record_id, kind, document_id, title, tags, body)
  VALUES (new.id, 'comment', new.task_id, '', '', new.body);
END;
