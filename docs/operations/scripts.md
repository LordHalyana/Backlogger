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

Walks project Markdown files and rebuilds metadata/indexes from disk.

Use after:

- restoring a backup
- large external file changes
- SQLite drift
- manual project folder mounts

### `npm run seed:docs`

Seeds the docs project from repository docs.

This writes runtime data. Use for dogfooding/demo setup, not against valuable production data unless you understand the target project id.

### `npm run register-docs`

Registers the repository docs as a Backlogger project.

Use for local dogfooding.

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
