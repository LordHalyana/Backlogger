---
id: d2e67efa-5878-4b7f-a64a-8ca3e7b5a426
title: "Block 5 — Phase 2 Hardening"
project: backlogger-docs
type: design_doc
status: archived
created_at: "2026-05-30T12:33:37.198Z"
updated_at: "2026-06-01T02:29:09.813Z"
tags: ["p2"]
---

# Block 5 — Phase 2 Hardening

> Parent: [../implementation_plan.md](../implementation_plan.md)
> Depends on: P2 Blocks 1, 2, 3, 4. P1 Block 6.
> Delivers: Playwright wired into CI, e2e specs covering every Phase-2 feature, perf bench and bundle audit, documentation updates.

---

## 1. Purpose

Tie off Phase 2. Make every new feature exercisable from the command line, prove the performance budget holds, and update the docs so a new contributor can understand the system end-to-end.

---

## 2. Scope

In scope:
- Install `@playwright/test` as a dev dep at the workspace root; install chromium browser in CI.
- Convert Phase-1's seed `smoke.spec.ts` into a real `e2e/` suite:
  - `smoke.spec.ts` (existing, kept).
  - `search.spec.ts` — create three docs, open command palette, search a unique phrase, click result, assert correct doc opens.
  - `links.spec.ts` — create two docs, link A → B with `[[B]]`, save, open B, assert backlink to A.
  - `tags.spec.ts` — set tags `[foo, bar]`, open sidebar tag explorer, click `foo`, assert filtered tree.
  - `user-templates.spec.ts` — drop a file into `data/templates/`, hit reload, assert it appears in the new-document dialog.
- GitHub Actions workflow `.github/workflows/ci.yml` extended with a `e2e` job that runs Playwright headed in CI.
- `scripts/bench-search.ts` invoked in CI as a smoke check (fail if p95 > 200 ms — looser than the dev target of 100 ms because CI VMs are slower).
- Bundle audit step: `vite-bundle-visualizer` (or `rollup-plugin-visualizer`) report uploaded as a build artifact; CI fails if the initial gzip bundle grows above 200 kB.
- README + design doc revision: add a "Phase 2 status" section and the new env vars (none expected, but called out explicitly).

Out of scope:
- Visual regression testing.
- Cross-browser e2e (chromium only this phase).
- Load testing beyond the search bench.

---

## 3. Design

### 3.1 Playwright

Move the existing `packages/web/playwright.config.ts` to the workspace root (`playwright.config.ts`) so all specs live in one place. Update the `webServer` block to start API + Vite with a deterministic data dir:

```ts
webServer: {
  command: 'BACKLOGGER_DATA_DIR=.e2e-data BACKLOGGER_PORT=3333 npm run dev',
  url: 'http://127.0.0.1:5173',
  reuseExistingServer: !process.env.CI,
  timeout: 60_000,
},
```

A `globalSetup` step wipes `.e2e-data/` before the run. Each spec creates a uniquely-named project at the top to avoid bleed across specs.

### 3.2 CI

`.github/workflows/ci.yml` jobs (added or extended):

- `lint-typecheck-test` (existing): `npm ci && npm run typecheck && npm run lint && npm test && npm run build`.
- `e2e` (new): depends on the build job; `npx playwright install --with-deps chromium && npm run test:e2e`.
- `bench` (new, allowed-to-fail at first): `tsx scripts/bench-search.ts --p95-budget=200`.
- `bundle-audit` (new): runs `npm run build`, then a tiny `scripts/bundle-audit.ts` that reads `packages/web/dist/assets/*.js`, computes gzip sizes, and fails if the initial chunk (matched by `index-*.js`) exceeds 200 kB gzip.

### 3.3 Scripts

- `scripts/bench-search.ts` — seeds N synthetic docs in a temp data dir, runs M queries, reports p50/p95/p99. CLI flag `--p95-budget=<ms>` makes it fail when exceeded.
- `scripts/bundle-audit.ts` — pure Node, no extra deps (`zlib.gzipSync` over file contents). Outputs a one-line summary `[bundle-audit] initial=124.5kB gzip (budget 200kB) ✅`.

### 3.4 Docs

- Append a "Phase 2 status" table to the root `docs/design/roadmap.md` linking each completed block.
- Add a "Search, Links, Tags" section to the README.
- Each P2 block's design doc gets a §7 Implementation Notes appended on completion, matching the P1 convention.

---

## 4. Tasks

| # | Task | Files |
|---|------|-------|
| 1 | Move + extend Playwright config | `playwright.config.ts`, remove `packages/web/playwright.config.ts` |
| 2 | `e2e/search.spec.ts` | `e2e/search.spec.ts` |
| 3 | `e2e/links.spec.ts` | `e2e/links.spec.ts` |
| 4 | `e2e/tags.spec.ts` | `e2e/tags.spec.ts` |
| 5 | `e2e/user-templates.spec.ts` | `e2e/user-templates.spec.ts` |
| 6 | CI workflow updates | `.github/workflows/ci.yml` |
| 7 | `scripts/bench-search.ts` | `scripts/bench-search.ts` |
| 8 | `scripts/bundle-audit.ts` | `scripts/bundle-audit.ts` |
| 9 | README + design doc updates | `README.md`, `docs/design/overview.md` |

---

## 5. Exit Criteria

- `npm run test:e2e` passes locally and in CI with all five specs.
- Bench step prints a numerical p95 and respects the 200 ms CI budget.
- Bundle audit step prints a size + verdict and respects the 200 kB gzip budget.
- README contains a Phase-2-features section.
- All Phase-2 block design docs end with §7 Implementation Notes.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Flaky e2e timing (debounced save) | Each spec polls for the visible "Saved" indicator before reload, just like the smoke spec. |
| CI cost from chromium download | Cache the playwright browsers folder keyed on the playwright version. |
| Bundle audit oscillates around the budget | Budget is computed against the post-build artifact; deterministic. Bumping the budget requires a PR comment justification. |
| Test data dir leaks between specs | `globalSetup` wipes `.e2e-data/templates/` once; per-spec uniqueness via timestamped project ids; user-template spec deletes its own template file in a `finally` block. |

---

## 7. Implementation Notes

Block 5 is **done**. 8/8 Playwright specs pass: `smoke`, `search` (×2), `links`, `tags` (×2), `user-templates` (×2). 134/134 unit tests preserved.

Key surprises and fixes worth recording:

- **`BACKLOGGER_DATA_DIR` must be an absolute path.** The npm workspace command `npm -w @backlogger/api run dev` changes cwd to `packages/api/` before invoking the server, so a relative value (e.g. `.e2e-data`) resolved differently in the server process and the Playwright process. Fix: compute `E2E_DATA_DIR = path.resolve(process.cwd(), '.e2e-data')` in [playwright.config.ts](../../../playwright.config.ts) and propagate it via both `process.env` and the `webServer.env` block.
- **`globalSetup` wipes only `.e2e-data/templates/`, never the whole dir.** Wiping the dir would race with `better-sqlite3` opening `backlogger.sqlite`.
- **Don't trust `getByText('Saved', { exact: false })` to detect autosave.** Playwright's substring text matcher is case-insensitive by default, so it also matches `Unsaved changes`. Specs that waited on this text continued past the typing step before the 800 ms debounced flush had fired, then reloaded the page and lost the edit. Fix: match the status label exactly via `page.locator('.status-label').toHaveText('Saved')`.
- **DocumentEditor needs a `lastEmittedRef` guard against React's value catch-up.** The `[value]` effect would otherwise re-dispatch a stale prop into CodeMirror mid-typing and clobber freshly typed characters. The guard records what the editor itself last emitted and skips the dispatch when `value` matches.
- **User-template specs must clean up their own files.** A leaked template file inflates the row count in the Settings template-table spec. The creator spec deletes its file in a `finally` block; the table spec triggers a `Reload` at the start to evict any stale server-side cache.
- **`getByRole('button', { name: 'Clear' })` is ambiguous when tag chips render their own remove buttons** (`aria-label="Remove tag X"`, which contains the substring "Clear" when the tag name does). Use `{ exact: true }` for the filter-bar clear button.
- `.e2e-data/`, `test-results/`, and `playwright-report/` are gitignored.
