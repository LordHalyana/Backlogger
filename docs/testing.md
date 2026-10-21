---
id: 4192f9f9-d854-4601-993c-1af8e7484095
title: Testing
project: backlogger-docs
type: note
status: active
created_at: '2026-06-04T00:00:00.000Z'
updated_at: '2026-06-04T00:00:00.000Z'
tags: []
---

# Testing

Date: 2026-06-04

## Test Stack

Backlogger uses:

- Vitest for unit, service, API, and component tests.
- Supertest for API route tests.
- React Testing Library for component tests.
- Playwright for end-to-end tests.
- Benchmark scripts for search and graph performance.

## Commands

Install dependencies first:

```bash
npm install
```

Run unit/API/component tests:

```bash
npm test
```

Run TypeScript checks:

```bash
npm run typecheck
```

Run lint:

```bash
npm run lint
```

Run e2e tests:

```bash
npm run test:e2e
```

Run search benchmark:

```bash
npm run bench
```

Run graph benchmark:

```bash
npm run bench:graph
```

Run bundle audit:

```bash
npm run bundle-audit
```

## Test Locations

API and services:

- `packages/api/src/app.test.ts`
- `packages/api/src/task-board.test.ts` (board, task state and write-safety; on-disk Markdown asserted byte for byte)
- `packages/api/src/coordinated-writes.test.ts` (write coordinator over HTTP: guards, lock order, gate, protected operational tables)
- `packages/api/src/comment-recovery.test.ts` (crash injected at each persisted phase of comment create, edit and delete, then `restart()`; task-scoped guards; the recovery API)
- `packages/api/src/search.test.ts` (grouped document/comment search: one result per task, strongest snippet, all terms within one record, archived and orphaned comments, pending payloads through Reload and Reindex)
- `packages/api/src/test-support.ts` (shared `setup()`/`teardown()` harness)
- `packages/api/src/fs/*.test.ts`
- `packages/api/src/services/*.test.ts`
- `packages/api/src/templates/*.test.ts`

Shared logic:

- `packages/shared/src/*.test.ts`

Web components:

- `packages/web/src/components/*.test.tsx`
- `packages/web/src/lib/*.test.ts`
- `packages/web/src/lib/*.test.tsx`

E2E:

- `e2e/*.spec.ts`

## Current Coverage Shape

Strong coverage exists for:

- API route behavior.
- filesystem path safety.
- repository operations.
- document service behavior.
- graph service behavior.
- health endpoint behavior.
- template registry behavior.
- wiki-link and Markdown helpers.
- core e2e workflows.

Known maintenance issue:

- `packages/api/src/app.test.ts` is large and covers many API areas. Split it opportunistically when making route-level changes.
- Storage, mounted-doc, reload, and reindex changes should keep coverage around:
  - frontmatterless Markdown indexing with derived metadata.
  - malformed frontmatter and mismatched project frontmatter indexing with repaired metadata.
  - first-edit adoption of derived plain Markdown when a project is editable.
  - skipped-file reporting from project reload and full reindex.
  - project read-only mode blocking document, folder, import, archive, and delete writes.
  - graph/search cache invalidation after reload removes or updates files.

Use API tests for service and route behavior first. Add e2e smoke coverage only when the user workflow changes, such as the read-only toggle, import dialog gating, or skipped-file feedback.

## Test Data

Tests should use temporary data directories and must not touch real `data/`.

E2E setup should create isolated projects and documents through the UI/API rather than relying on local personal data.

## When To Run What

Small frontend component change:

```bash
npm run typecheck
npm test
```

API/service change:

```bash
npm run typecheck
npm test
```

User workflow change:

```bash
npm test
npm run test:e2e
```

Search or graph change:

```bash
npm test
npm run bench
npm run bench:graph
```

Frontend dependency or lazy-loading change:

```bash
npm run build
npm run bundle-audit
```

## Verification Limits

If dependencies are not installed, commands that rely on `node_modules/.bin` will fail with messages such as:

```text
'tsc' is not recognized
'eslint' is not recognized
```

Install dependencies before treating test results as authoritative.
