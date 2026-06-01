---
slug: import-export
title: Import & Export
order: 7
---

# Import & Export

Backlogger documents are plain `.md` files. You can move them in and out
without writing custom tooling.

## Importing

Click **Import** in the topbar to open the import dialog. Pick one or more
`.md` files from your machine and click **Import**.

- Files with frontmatter `id` matching an existing document are treated as
  **conflicts**. Use the *Replace* checkbox to overwrite; otherwise they
  are reported as `skipped`.
- Files without an `id` get a freshly generated one on import.
- A summary at the end shows `added`, `replaced`, and `skipped` counts.

The HTTP API is `POST /api/projects/:id/import` with a JSON body listing
`{ filename, content }` pairs — the dialog is a thin wrapper around it.

## Exporting

Open the document you want to export and click **Download** in the toolbar.
The raw `.md` (frontmatter included) is streamed to your browser.

For bulk export, copy the project folder from `data/projects/<id>/` —
that *is* the export format.

## Sync workflows

Because the canonical format is files on disk, Backlogger pairs well with
any directory-sync tool (Git, rsync, Dropbox, Syncthing). After a sync
pulls remote changes, click **Reload** to refresh the indexes.

See also: **Projects**.
