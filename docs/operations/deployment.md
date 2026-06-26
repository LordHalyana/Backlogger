---
id: 473e6acc-9313-4e2f-bd30-f1b06ed81377
title: Deployment
project: backlogger-docs
type: note
status: active
created_at: '2026-06-04T00:00:00.000Z'
updated_at: '2026-06-04T00:00:00.000Z'
tags: []
---

# Deployment

Date: 2026-06-04

## Local Development

Install dependencies:

```bash
npm install
```

Create an environment file if needed:

```bash
cp .env.example .env
```

Run both API and web dev servers:

```bash
npm run dev
```

Default endpoints:

- API: `http://127.0.0.1:3333`
- Web: `http://127.0.0.1:5173`

The Vite dev server proxies `/api` and `/health` to the API.

## Docker

Run:

```bash
docker compose up -d
```

Open:

```text
http://localhost:3002
```

In production/Docker, the Express API serves the built web app.

## Data Volume

Backlogger state is under `BACKLOGGER_DATA_DIR`.

Default local value:

```text
./data
```

Docker default:

```text
/app/data
```

Mount a volume here for persistence.

## Existing Project Folder Mounts

You can mount an existing folder as a project:

```bash
docker run -d \
  -p 3002:3002 \
  -v backlogger-data:/app/data \
  -v /path/to/my-project:/app/data/projects/my-project \
  backlogger
```

On startup, the server registers valid project folders that are present on disk but missing from SQLite, then reindexes them.

Project folder names must match:

```text
^[a-z0-9][a-z0-9-]{1,62}$
```

See `docs/operations/data-storage.md` for the full storage and mounted-project contract.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `BACKLOGGER_HOST` | `0.0.0.0` | API bind address. Use `127.0.0.1` when the app should not be reachable from the LAN. |
| `BACKLOGGER_PORT` | `3333` locally, `3002` in Docker | API port. |
| `BACKLOGGER_WEB_PORT` | `5173` | Vite dev server port. |
| `BACKLOGGER_DATA_DIR` | `./data` | Data root. |
| `BACKLOGGER_TEMPLATES_DIR` | `packages/api/templates` | Built-in template directory (resolved relative to the compiled API by default). |
| `BACKLOGGER_ALLOWED_ORIGINS` | `*` | Browser CORS allow-list. |
| `BACKLOGGER_WATCH` | `1` | Set `0` to disable filesystem auto-reindex. See [File Watching](#file-watching). |
| `NODE_ENV` | unset locally, `production` in Docker | When `production`, the Express API also serves the built web app from `packages/web/dist`. |
| `LOG_LEVEL` | `info` | Server log verbosity. |

## CORS

Default CORS reflects any origin:

```text
BACKLOGGER_ALLOWED_ORIGINS=*
```

This is convenient for trusted LAN access. It is not a safe default for an
untrusted network because any browser origin can call the API. Bind the server
to `127.0.0.1` or set a comma-separated allow-list before exposing the app.

```text
BACKLOGGER_ALLOWED_ORIGINS=http://home.local,http://127.0.0.1:5173
```

An empty value disables cross-origin browser access.

## File Watching

Backlogger watches `BACKLOGGER_DATA_DIR/projects` and auto-reindexes a project
when its Markdown changes on disk. On Linux this uses inotify, which has a
per-user watch limit (`fs.inotify.max_user_watches`). Large document trees —
especially inside containers — can exhaust it, producing:

```text
Error: ENOSPC: System limit for number of file watchers reached
```

The watcher catches this and **self-disables for the session**: the server keeps
running, and startup sync plus the manual **Reload** button still re-index. To
restore live watching, raise the limit on the **host** (containers share the
host kernel):

```bash
sudo sysctl fs.inotify.max_user_watches=524288
echo 'fs.inotify.max_user_watches=524288' | sudo tee /etc/sysctl.d/99-backlogger.conf
sudo sysctl --system
```

To turn file watching off entirely, set `BACKLOGGER_WATCH=0`; the server then
relies on startup sync and manual Reload.

## Templates

Built-in templates load from `BACKLOGGER_TEMPLATES_DIR`.

User templates load from:

```text
<BACKLOGGER_DATA_DIR>/templates
```

Settings can reload templates without restarting the server.

## Startup Behavior

On startup the server:

1. Loads `.env`.
2. Opens SQLite and applies migrations through `openDatabase`.
3. Loads built-in and user templates.
4. Ensures data directories exist.
5. Watches user templates.
6. Watches project files for reload/reindex work (unless `BACKLOGGER_WATCH=0`).
7. Discovers project folders missing from the database.
8. Syncs known projects so Markdown changed while the server was stopped is picked up.
9. Runs a full reindex if the document table is empty but Markdown exists.

Startup discovery, startup sync, startup full reindex, and watcher-triggered
sync log skipped Markdown files with path and reason details. Check these logs
when a mounted project appears but some docs are missing.

## Operational Checks

Use:

```bash
curl -fsS http://127.0.0.1:3333/health
```

See `docs/operations/monitoring.md` for health details.
