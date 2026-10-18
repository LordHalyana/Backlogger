-- Index projection of a document's frontmatter `task_state`, verbatim (NULL
-- when absent). The file stays the source of truth; the board reads this.
ALTER TABLE documents ADD COLUMN task_state TEXT;
