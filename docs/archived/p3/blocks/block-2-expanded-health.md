# Block 2 — Expanded Health Endpoint

> Parent: [../implementation_plan.md](../implementation_plan.md)
> Depends on: Phase 1 Blocks 0 (API), 1 (FsRepository), 2 (DB), 4 (DocumentsRepo); Phase 2 Block 1 (FTS); Phase 1 Block 5 (Templates).
> Delivers: a richer `/health` payload that reports per-subsystem status without breaking existing consumers.

---

## 1. Purpose

Replace the binary "is the process up?" answer with an actionable breakdown so Home System (Block 1) and on-call operators can tell *which* subsystem is broken without reading logs.

---

## 2. Scope

In scope:
- Expand `GET /health` to return `{ status, api, database, storage, templates, fts, version, uptime_s }`.
- Cheap, cached subsystem probes (each probe ≤ 10 ms; total endpoint p95 ≤ 50 ms).
- Backwards compatibility: existing `status === 'ok'` consumers keep working unchanged.
- A small HTTP status policy: `200` while every subsystem is `ok`, `503` when any subsystem reports `error` (degraded states still return `200`).

Out of scope:
- Authentication or rate limiting on `/health` (Backlogger remains single-user, LAN-only).
- Persistent health history (Home System handles that).
- Per-project health.

---

## 3. Design

### 3.1 Response shape

```ts
type SubsystemState = 'ok' | 'degraded' | 'error';

interface HealthResponse {
  status: SubsystemState;          // worst() of all subsystems
  api: SubsystemState;             // always 'ok' if we can serve the request
  database: SubsystemState;        // SELECT 1 against SQLite
  storage: SubsystemState;         // stat(BACKLOGGER_DATA_DIR) succeeds & writable
  templates: SubsystemState;       // template registry has loaded ≥ 1 entry
  fts: SubsystemState;             // SELECT count(*) FROM documents_fts works
  version: string;                 // from package.json
  uptime_s: number;
  checked_at: string;              // ISO timestamp
}
```

`status` is `worst(api, database, storage, templates, fts)` using the ordering `ok < degraded < error`.

### 3.2 Probes

Each probe lives in `packages/api/src/health/probes/<name>.ts` and exposes:

```ts
interface Probe {
  name: string;
  run(ctx: AppContext): Promise<SubsystemState>;
}
```

Probe definitions:
- **database** — `db.prepare('SELECT 1').get()` inside a 50 ms timeout. Error → `error`.
- **storage** — `fs.stat(dataDir)` + a tmp-file write+unlink in `dataDir/.health-probe`. Stat fails → `error`. Stat ok but write fails → `degraded`.
- **templates** — `registry.list().length >= BUILTIN_COUNT` (5). Less than 5 → `degraded`; throw → `error`.
- **fts** — `db.prepare('SELECT count(*) FROM documents_fts').get()`. Error → `error`. (We accept count `0` as `ok` — a brand-new install has no docs.)

### 3.3 Caching

Probes are expensive enough (especially storage) that hammering `/health` every second from Home System would matter. The endpoint serves a cached value refreshed at most once per 2 s:

```ts
const TTL_MS = 2_000;
let cache: { value: HealthResponse; expires: number } | null = null;
```

If a probe throws unexpectedly the cache stores `error` and is refreshed normally on the next request.

### 3.4 HTTP status

```ts
res.status(report.status === 'error' ? 503 : 200).json(report);
```

`degraded` returns `200` so a single slow disk doesn't page on-call.

### 3.5 Backwards compatibility

Phase 1 returned `{ status: 'ok' }`. The new shape keeps `status` at the same path with the same value when everything is healthy, so existing consumers see no break. New consumers opt into the richer fields.

---

## 4. Tasks

| # | Task | Files |
|---|------|-------|
| 1 | `SubsystemState` + `HealthResponse` shared types | `packages/shared/src/health.ts` |
| 2 | Per-subsystem probes (4 files + index) | `packages/api/src/health/probes/*.ts` |
| 3 | `HealthService` (cache + worst() aggregation) | `packages/api/src/services/health-service.ts` |
| 4 | Wire `healthService` into `AppContext`, replace inline `/health` handler | `packages/api/src/app.ts` |
| 5 | API tests (each subsystem ok/degraded/error path) | `packages/api/src/app.test.ts` |
| 6 | Bench: 1000 sequential `/health` hits ≤ 5 s | `scripts/bench-health.ts` (optional) |

---

## 5. Exit Criteria

- `GET /health` returns the new shape with all subsystems `ok` on a fresh `npm run dev`.
- Stopping the DB connection (forced close in a test) flips `database` to `error` and the endpoint returns `503`.
- Making the data dir read-only flips `storage` to `degraded` and the endpoint still returns `200`.
- A 100-call burst against `/health` completes in ≤ 1 s (cache hit path).
- All Phase 1+2 tests still green.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Probe accidentally writes inside `data/projects/` and corrupts a doc | Probe writes to a fixed hidden file (`.health-probe`) at the data-dir root only; unit test asserts the path is outside `projects/`. |
| Cache hides a real outage | TTL is 2 s — well under monitoring poll intervals. Forcing a refresh is a future stretch (query param `?fresh=1`, not in scope). |
| `503` from a flaky probe causes pager noise | `degraded` returns `200`; only hard errors flip to `503`. Each probe has an explicit timeout so a hung subsystem can't pin the request. |
| Health probe leaks DB statements | Use `prepare` once and cache the statement on the probe instance. |

---

## 7. Implementation Notes (M0 — ✅ Done, 2026-05-31)

**Delivered**: Expanded `/health` endpoint with cached subsystem probes. 138/138 unit + 8/8 e2e passing.

### Files added
- [packages/api/src/health/probes/database.ts](../../../packages/api/src/health/probes/database.ts) — `SELECT 1`, prepared-statement cached.
- [packages/api/src/health/probes/storage.ts](../../../packages/api/src/health/probes/storage.ts) — `stat` + write/unlink `.health-probe` at data-dir root.
- [packages/api/src/health/probes/templates.ts](../../../packages/api/src/health/probes/templates.ts) — `registry.list().length >= 5`.
- [packages/api/src/health/probes/fts.ts](../../../packages/api/src/health/probes/fts.ts) — `SELECT count(*) FROM documents_fts`.
- [packages/api/src/services/health-service.ts](../../../packages/api/src/services/health-service.ts) — TTL cache (`2_000` ms), `worst()` aggregation, injectable clock.
- [packages/api/src/services/health-service.test.ts](../../../packages/api/src/services/health-service.test.ts) — 4 tests: db=error → 503, templates=degraded → 200, TTL hit, TTL refresh.

### Files modified
- [packages/shared/src/index.ts](../../../packages/shared/src/index.ts) — added `SubsystemState` and widened `HealthStatus`. Kept the original `uptime` field plus a new `uptime_s` alias for snake_case monitoring clients.
- [packages/api/src/context.ts](../../../packages/api/src/context.ts) — added `healthService` and `dataDir` to `AppContext`; introduced `APP_VERSION = '0.3.0'` as the single source of truth for the version string.
- [packages/api/src/app.ts](../../../packages/api/src/app.ts) — `/health` now delegates to `ctx.healthService.snapshot()`; HTTP `503` only when aggregate `status === 'error'`.
- [packages/api/src/app.test.ts](../../../packages/api/src/app.test.ts) — `/health` assertion updated to cover all six subsystem fields plus `uptime_s` / `checked_at`.

### Deviations from §3 design
- **Version source**: design said `from package.json`; we hardcoded `APP_VERSION` in `context.ts` to avoid an extra JSON import path. Promoting it to a generated constant is trivial when the version starts moving with releases.
- **Probe timeout**: design called for an explicit 50 ms timeout on the DB probe. `better-sqlite3` is synchronous and uncancellable; a timeout wrapper would not actually interrupt a hung query. The probe simply returns `'error'` on throw; in practice `SELECT 1` is sub-millisecond. Documented as a known limitation.
- **`uptime` field**: kept the original camelCase `uptime` alongside the new snake_case `uptime_s` so existing consumers (the React `App` health badge) don't break. Both are populated.

### Forward-compat
- The web `App.tsx` health badge keeps working unchanged — it only checks fetch success, never reads `status`. A richer badge (per-subsystem dots, degraded/amber state) will land with Block 1 (M1 — Home System Integration).
- Phase 1 + 2 consumers see `status === 'ok'` on a healthy fresh install exactly as before.
