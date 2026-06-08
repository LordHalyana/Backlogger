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

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `BACKLOGGER_HOST` | `0.0.0.0` | API bind address. |
| `BACKLOGGER_PORT` | `3333` locally, `3002` in Docker | API port. |
| `BACKLOGGER_WEB_PORT` | `5173` | Vite dev server port. |
| `BACKLOGGER_DATA_DIR` | `./data` | Data root. |
| `BACKLOGGER_TEMPLATES_DIR` | `packages/api/templates` | Built-in template directory. |
| `BACKLOGGER_ALLOWED_ORIGINS` | `*` | Browser CORS allow-list. |

## CORS

Default CORS reflects any origin:

```text
BACKLOGGER_ALLOWED_ORIGINS=*
```

This is convenient for LAN access. For a less trusted network, set a comma-separated allow-list:

```text
BACKLOGGER_ALLOWED_ORIGINS=http://home.local,http://127.0.0.1:5173
```

An empty value disables cross-origin browser access.

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
6. Watches project files for reload/reindex work.
7. Discovers project folders missing from the database.
8. Runs a full reindex if the document table is empty but Markdown exists.

## Operational Checks

Use:

```bash
curl -fsS http://127.0.0.1:3333/health
```

See `docs/operations/monitoring.md` for health details.
