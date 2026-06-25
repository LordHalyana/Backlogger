---
slug: mounting-docs
title: Mounting Existing Docs
order: 75
---

# Mounting existing docs

Backlogger can browse and edit a docs folder from another project without
copying it or changing its format. Point a project at the folder and Backlogger
indexes the Markdown files in place.

## Mount a folder

Place (or symlink, or Docker-mount) the folder under the data directory as a
project:

```text
<BACKLOGGER_DATA_DIR>/projects/<project-id>/   ->   your docs folder
```

On startup Backlogger auto-discovers it, creates the project **read-only**, and
indexes every `.md` file. Plain Markdown without Backlogger frontmatter shows up
as a read-only document you can read, search, link, and view in the graph.

## Make it editable

Use the project switcher toggle to turn **Read-only** off. The first time you
save a plain-Markdown document, Backlogger adopts it so it becomes fully
editable.

## Keep source files pristine: sidecar mode

By default, adopting a document writes Backlogger frontmatter into the file. If
you don't want to modify the source files at all, switch the project to
**Sidecar** mode (the toggle next to Read-only / Editable).

In sidecar mode:

- Backlogger metadata (type, status, tags, id, optional title) is stored in
  `<project>/.backlogger/index.json`, not in the files.
- Editing a document never adds frontmatter to it.
- Archiving sets the status in the sidecar; the file is not moved.
- The database can still be rebuilt from the files plus the sidecar.

Switch back to **Frontmatter** mode at any time; documents that already have
frontmatter keep it.
