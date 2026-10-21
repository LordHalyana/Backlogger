-- Derived index of comment files (spec #58): one row per valid comment at
-- <project>/tickets/<task>/comments/<id>.md. Rebuilt from Markdown by Reload
-- and Reindex, like documents, and kept apart from documents so comments
-- never appear in document lists, the board or Current work. No foreign key
-- to documents: the files, not the index, decide what exists.
CREATE TABLE comments (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL,
  project_id TEXT NOT NULL,
  path       TEXT NOT NULL UNIQUE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision   TEXT NOT NULL
);
CREATE INDEX comments_by_task ON comments (task_id, created_at, id);
CREATE INDEX comments_by_project ON comments (project_id);
