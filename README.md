# Backlogger

Self-hosted Markdown workspace for ideas, design documents, implementation plans, and backlogs.

> Status: mounted-docs and maintainability cleanup in progress. See [docs/README.md](docs/README.md) for current documentation and [docs/design/roadmap.md](docs/design/roadmap.md) for current priorities.

## Features

**Full-text Search** - Press `Ctrl/Cmd+K` to open the command palette. Type any word or phrase to search across all documents in real time. Results show ranked snippets; pressing Enter or clicking opens the document.

**Document Linking** - Type `[[Document Title]]` in any editor to create a wiki-style link. Links resolve on save; the linked document's sidebar shows a live Backlinks panel listing every document that points to it.

**Tag Explorer** - Add comma- or Enter-separated tags on any document's metadata panel. Tags appear in the sidebar with counts; click a tag to filter the document tree. Multiple active tags use AND semantics. A filter bar above the tree shows active tags with remove chips and a Clear button.

**User-defined Templates** - Drop a Markdown file with `template_id:` / `template_name:` frontmatter into `data/templates/`. Open Settings in the topbar, click **Reload**, and the template appears in the New Document dialog with a "user" badge - no restart needed.

**Folder Management** - Organize documents into collapsible nested folders from the project tree. Add folders, delete empty folders from manage mode, and choose a folder when creating a document; the hierarchy persists across reloads.

**Knowledge Graph** - Click **Graph** in the topbar to open an interactive canvas overlay showing every document as a node and every wiki-link as a directed edge. Filter by title or tag, hover to highlight neighbors, click a node to open the document. Broken links (targets that don't exist yet) appear as red sink nodes.

## Quickstart

### Local development

```bash
npm install
cp .env.example .env     # tweak BACKLOGGER_PORT / BACKLOGGER_ALLOWED_ORIGINS if needed
npm run dev
```

- API: http://127.0.0.1:3333 (health: `/health`)
- Web: http://127.0.0.1:5173

Both the API and the Vite dev server bind `0.0.0.0` by default, so the app
is reachable from another device on your LAN at
`http://<your-lan-ip>:5173`. CORS defaults to reflect-any-origin
(`BACKLOGGER_ALLOWED_ORIGINS=*`) so cross-device access works out of the
box. On untrusted networks, bind to localhost or set
`BACKLOGGER_ALLOWED_ORIGINS` to a comma-separated allow-list before exposing
the app.

The web dev server proxies `/api` and `/health` to the API.

### Docker

```bash
docker compose up -d
```

Open http://localhost:3002. The API serves the built web frontend, so only one port is needed.

**Mount an existing docs folder as a project:**

```bash
docker run -d \
  -p 3002:3002 \
  -v backlogger-data:/app/data \
  -v /path/to/my-project:/app/data/projects/my-project \
  backlogger
```

Any folder (or symlink) placed under `/app/data/projects/` is auto-discovered and registered on startup - no manual import needed. The folder name becomes the project ID.

For details on mounted docs folders, indexing behavior, and current frontmatter requirements, see [docs/operations/data-storage.md](docs/operations/data-storage.md).

**Build the image locally:**

```bash
docker build -t backlogger .
```

**Environment variables in Docker** - pass them with `-e` or via the `environment:` key in `docker-compose.yml`:

| Variable | Docker default | Purpose |
|----------|---------------|---------|
| `BACKLOGGER_DATA_DIR` | `/app/data` | DB + user templates root. Mount a volume here. |
| `BACKLOGGER_PORT` | `3002` | Port the server listens on inside the container. |
| `BACKLOGGER_HOST` | `0.0.0.0` | Bind address. |
| `BACKLOGGER_ALLOWED_ORIGINS` | `*` | CORS allow-list. |

## Scripts

| Command            | What it does                              |
|--------------------|-------------------------------------------|
| `npm run dev`      | Run API + web concurrently in watch mode. |
| `npm run build`    | Build all workspaces.                     |
| `npm test`         | Run Vitest across all packages.           |
| `npm run test:e2e` | Run Playwright e2e suite (chromium).      |
| `npm run lint`     | ESLint, zero warnings tolerated.          |
| `npm run typecheck`| `tsc -b --noEmit` across the monorepo.    |
| `npm run format`   | Prettier write.                           |
| `npm run db:migrate` | Apply SQL migrations.                  |
| `npm run reindex`  | One-shot CLI: rescans `data/` and rebuilds metadata. |
| `npm run bench`    | Search latency bench (p50/p95/p99 on 1 k docs). |
| `npm run bench:graph` | Knowledge-graph latency bench (p50/p95/p99 on 1 k docs / 5 k links). |
| `npm run bundle-audit` | Verify initial JS gzip <= 220 kB.    |

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `BACKLOGGER_HOST` | `0.0.0.0` | API bind address. Use `127.0.0.1` when the app should not be LAN-reachable. |
| `BACKLOGGER_PORT` | `3333` | API listen port. |
| `BACKLOGGER_WEB_PORT` | `5173` | Vite dev server port. |
| `BACKLOGGER_DATA_DIR` | `./data` | Where `projects/` and `backlogger.sqlite` live. |
| `BACKLOGGER_TEMPLATES_DIR` | `packages/api/templates` | Override the built-in document templates directory. |
| `BACKLOGGER_ALLOWED_ORIGINS` | `*` | CORS allow-list. `*` reflects any origin; use a comma-separated list on untrusted networks; empty disables CORS. |

`.env` at the repo root is loaded automatically by the API.

## Layout

```text
packages/
|-- shared/   # zod schemas, types, markdown utils (shared FE/BE)
|-- api/      # Express server
`-- web/      # React + Vite app
data/         # runtime data (gitignored) - filesystem source of truth
docs/         # current docs, cleanup reports, and archived historical plans
Dockerfile
docker-compose.yml
```

## Theme

The UI defaults to a dark theme. The choice is persisted in `localStorage` and applied before React mounts to avoid a flash of light content.

## Backup

`data/` is the entire app state. Copy it; that's the backup.
