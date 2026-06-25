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

- `projects/`: Markdown files and project folders.
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
```

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

Files with invalid Backlogger frontmatter or a mismatched `project` value are
skipped and reported by reindex. Plain Markdown without Backlogger frontmatter
is indexed with derived metadata; it can be adopted on first edit after the
project is explicitly switched to editable mode.