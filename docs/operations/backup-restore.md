---
id: 9ed32955-3588-40b8-bff9-7df831440a28
title: Backup And Restore
project: backlogger-docs
type: note
status: active
created_at: '2026-06-04T00:00:00.000Z'
updated_at: '2026-06-04T00:00:00.000Z'
tags: []
---

# Backup And Restore

Date: 2026-06-04

## What To Back Up

Back up the full `BACKLOGGER_DATA_DIR`.

By default this is:

```text
./data
```

It contains:

- `projects/`: Markdown files and project folders, including the designated
  Inbox's folder (`projects/inbox/` unless that id was taken).
- `workspace.json`: which project is the designated Inbox. It is the only
  record of that designation.
- `backlogger.sqlite`: SQLite metadata and derived indexes.
- `templates/`: user templates.

The Markdown files are the most important data. SQLite can be rebuilt from disk, but preserving it keeps startup fast and preserves project rows that may not be represented by files.

## Recommended Backup Procedure

1. Stop Backlogger.
2. Copy the full data directory.
3. Start Backlogger.

Stopping the app avoids copying SQLite mid-write.

## Minimal Backup

If you can only back up one thing, back up:

```text
data/projects/
```

Also back up:

```text
data/templates/
data/workspace.json
```

Without `workspace.json`, the next start creates a new, empty Inbox (`inbox-2`
if `inbox/` exists); the old Inbox folder comes back as an ordinary read-only
project.

After restoring a minimal backup, recreate or rediscover project rows and run reindex.

## Restore Procedure

1. Stop Backlogger.
2. Replace `BACKLOGGER_DATA_DIR` with the backup.
3. Start Backlogger.
4. Check `/health`.
5. Rebuild derived data if it looks stale, with either:

```bash
npm run reindex
# or, against a running server:
curl -X POST http://127.0.0.1:3333/api/admin/reindex
```

## Restoring Into Docker

Restore into the mounted data volume or bind mount used as `/app/data`.

Example:

```bash
docker compose down
# restore files into the mounted volume or host directory
docker compose up -d
```

## External File Edits

Backlogger supports external edits because Markdown files are the source of truth. After large external changes, run project reload or full reindex.

Use project reload from the app when possible. Use full reindex when many projects changed or when restoring from backup.

## What Not To Do

- Do not edit `backlogger.sqlite` manually.
- Do not restore a partial SQLite file over a running app.
- Do not rely on CORS or LAN isolation as a backup control.
- Do not delete Markdown files expecting SQLite to preserve content.

## Recovery Expectations

If SQLite is missing but project folders exist:

- Startup may auto-discover valid project folders.
- A full reindex (`POST /api/admin/reindex`) rebuilds document metadata from
  Backlogger frontmatter or derives metadata for plain Markdown files.
- The designated Inbox named in `workspace.json` is registered again as a
  writable project called "Inbox". Other projects come back read-only with a
  name derived from their folder (a known limitation).

If a move between projects (filing) was interrupted, the same task can exist
in two project folders with one id. Reindex indexes one copy — the one outside
the Inbox, otherwise the first path — and lists the other under `duplicates`
in its report; delete that file.

Files with invalid Backlogger frontmatter or a mismatched `project` value are
skipped and reported by reindex. Plain Markdown without Backlogger frontmatter
is indexed with derived metadata; it can be adopted on first edit after the
project is explicitly switched to editable mode.

## Pending Operations And Recovery Review

Pending operations, retry receipts and recovery payloads are stored in
`backlogger.sqlite`. They are not derived from Markdown, so Reload and
Reindex never rebuild them. Losing the database loses this retry and recovery
history, even when the Markdown is intact. Rebuilding the index from Markdown
is not the same as restoring the database.

On startup, Backlogger tries to finish every pending operation. Operations it
cannot finish stay listed at `GET /api/recovery`, and only the tasks and
files they involve stay blocked (`RECOVERY_REQUIRED`). See
[Recovery](../api.md#recovery).

## Manual Structural Repair

Repair by hand when recovery reports a `structural` problem: a missing file,
a missing parent task, a changed owner or an ambiguous path. Backlogger has
no repair tool. Follow these steps:

1. Stop Backlogger.
2. Copy the full data directory: Markdown, `workspace.json` and
   `backlogger.sqlite` with its `-wal` and `-shm` files.
3. Repair only the paths that `GET /api/recovery/:operationId` lists, so that
   each file matches its expected state. For example, put a missing task file
   back from a backup, or move a comment file back under its task.
4. Restart Backlogger. Startup recovery runs again.
5. Inspect `GET /api/recovery`. Recheck anything still listed, or abandon a
   comment operation you no longer want.

Never edit the operational tables (`operations`, `operation_payloads`,
`operation_manifest_entries`, `operation_guards`) by hand.
