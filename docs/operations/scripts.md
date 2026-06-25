---
id: 43c255a7-b6af-4930-8ef9-236acb66095f
title: Scripts
project: backlogger-docs
type: note
status: active
created_at: '2026-06-04T00:00:00.000Z'
updated_at: '2026-06-04T00:00:00.000Z'
tags: []
---

# Scripts

Date: 2026-06-04

## Root Scripts

Run scripts from the repository root.

### `npm run dev`

Starts API and web dev servers concurrently.

Safe for local development.

### `npm run build`

Builds all workspaces.

Use before Docker/package release checks.

### `npm test`

Runs Vitest tests.

Requires dependencies installed.

### `npm run lint`

Runs ESLint with zero warnings allowed.

Requires dependencies installed.

### `npm run typecheck`

Runs TypeScript project references.

Requires dependencies installed.

### `npm run test:e2e`

Runs Playwright e2e tests.

Requires browsers and dependencies installed.

### `npm run format`

Runs Prettier write over the repo.

This changes files.

### `npm run format:check`

Checks formatting without writing.

## Data And Maintenance Scripts

### `npm run db:migrate`

Runs SQL migrations against the configured data directory.

Use when upgrading schema or preparing a new environment.

### `npm run reindex`

Prints a read-only summary of the Markdown files on disk (document counts per
project and per `type`). It does **not** rebuild the SQLite `documents` table or
any derived index — it is a filesystem sanity check.

To actually rebuild metadata and indexes from disk, use the API: `POST
/api/admin/reindex` (all projects) or `POST /api/projects/:id/reload` (one
project). Startup also auto-reindexes when the documents table is empty.

Use `npm run reindex` to confirm the filesystem layer sees the expected files
after:

- restoring a backup
- large external file changes
- manual project folder mounts

### `npm run register-docs`

Registers the repository docs as a Backlogger project.

Preferred for local dogfooding. This matches the mounted-docs workflow by
registering the repository `docs/` folder in place, instead of copying it into
runtime data.

### `npm run seed:docs`

Demo-only. Seeds the docs project by copying repository docs into runtime data.

This deletes and recreates the `backlogger-docs` runtime project folder and DB
row before writing copied files. Do not use it against valuable data. Prefer
`npm run register-docs` unless you specifically need a disposable copied demo
project.

## Bench And Audit Scripts

### `npm run bench`

Runs search latency benchmark.

Use before release or after search/index changes.

### `npm run bench:graph`

Runs graph latency benchmark.

Use after graph service or link-index changes.

### `npm run bundle-audit`

Checks initial JavaScript gzip size against the current budget.

Use after frontend dependency or graph/editor changes.

## Safety Notes

- Read script source before running against real data.
- Back up `data/` before running scripts that seed, register, migrate, or reindex important workspaces.
- Do not run formatting scripts if you are trying to keep a narrow diff.
