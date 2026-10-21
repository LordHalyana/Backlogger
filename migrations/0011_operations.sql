-- Protected operational state for the write coordinator (spec #58). These
-- tables are not derived from Markdown: Reload and Reindex never touch them,
-- and nothing references the documents table, so deleting a task or comment
-- never cascades into them.

-- One row per operation ID: pending while it runs (or after a crash),
-- completed with its acknowledgement as the retry receipt, or abandoned.
-- The primary key settles retry races: a second intent insert for the same ID
-- fails and the caller looks the receipt up again.
CREATE TABLE operations (
  operation_id TEXT PRIMARY KEY,
  command      TEXT NOT NULL,
  fingerprint  TEXT NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('pending', 'completed', 'abandoned')),
  -- Acknowledgement metadata (JSON), never content bodies.
  outcome      TEXT,
  created_at   TEXT NOT NULL,
  completed_at TEXT
);

-- Exact intended bytes of a pending operation; removed on completion.
CREATE TABLE operation_payloads (
  operation_id TEXT PRIMARY KEY REFERENCES operations(operation_id) ON DELETE CASCADE,
  payload      TEXT NOT NULL
);

-- Transfer and deletion inventories: the paths an operation covers and the
-- fingerprints they are expected to have.
CREATE TABLE operation_manifest_entries (
  operation_id TEXT NOT NULL REFERENCES operations(operation_id) ON DELETE CASCADE,
  path         TEXT NOT NULL,
  role         TEXT NOT NULL,
  fingerprint  TEXT,
  PRIMARY KEY (operation_id, path, role)
);

-- What a pending operation blocks until it completes or is resolved: a whole
-- project, one task (and its comments) or one path. Path keys are relative
-- to <dataDir>/projects/ and so start with the project id, like
-- documents.path; they are unique across projects. Every
-- guard names the project it lives in, so "anything pending in this project"
-- is one lookup.
CREATE TABLE operation_guards (
  operation_id TEXT NOT NULL REFERENCES operations(operation_id) ON DELETE CASCADE,
  project_id   TEXT NOT NULL,
  scope        TEXT NOT NULL CHECK (scope IN ('project', 'task', 'path')),
  key          TEXT NOT NULL,
  PRIMARY KEY (operation_id, scope, key)
);
CREATE INDEX operation_guards_by_key ON operation_guards (scope, key);
CREATE INDEX operation_guards_by_project ON operation_guards (project_id);
