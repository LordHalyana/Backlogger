-- Document link index.
-- Filesystem (frontmatter + body) remains source of truth; this table is rebuildable via reindex.

CREATE TABLE links (
  source_id    TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  target_id    TEXT REFERENCES documents(id) ON DELETE SET NULL,
  target_title TEXT NOT NULL,
  target_title_norm TEXT NOT NULL,
  display      TEXT NOT NULL,
  position     INTEGER NOT NULL,
  PRIMARY KEY (source_id, position)
);

CREATE INDEX idx_links_target_id ON links(target_id);
CREATE INDEX idx_links_target_title_norm ON links(target_title_norm);
