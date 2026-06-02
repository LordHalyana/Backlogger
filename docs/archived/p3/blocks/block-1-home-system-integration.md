---
id: bba8f051-eb54-4e8a-9695-f0a48f928e8d
title: "Block 1 — Home System Integration"
project: backlogger-docs
type: design_doc
status: archived
created_at: "2026-05-31T13:43:53.276Z"
updated_at: "2026-05-31T14:12:13.841Z"
tags: ["p3"]
---

# Block 1 — Home System Integration

> Parent: [../implementation_plan.md](../implementation_plan.md)
> Depends on: Block 2 (Expanded Health Endpoint).
> Delivers: Home System monitors Backlogger as a first-class service via the expanded `/health` endpoint, with a dashboard tile showing subsystem badges.

---

## 1. Purpose

Make Backlogger visible to the operator. From Home System's status dashboard a user should see, at a glance: is Backlogger up, which subsystems are healthy, and how long it has been running.

This block has no UI work *inside* Backlogger — the Backlogger side is exclusively the `/health` contract from Block 2 plus a CORS / accept-poll affordance. The actual tile lives in Home System.

---

## 2. Scope

In scope (Backlogger side):
- Confirm `/health` returns the Block 2 payload and is reachable from Home System over the LAN.
- Tighten CORS: allow `GET /health` from the Home System origin (env-configurable, defaults to permissive on `127.0.0.1`).
- Document the contract under [docs/operations/monitoring.md](../../operations/monitoring.md) (new file).
- Publish a small JSON Schema for `HealthResponse` so Home System can validate it.

In scope (Home System side, documented here but executed in that repo):
- Backlogger service definition (URL, poll interval, timeout).
- Dashboard tile rendering the six subsystem badges + uptime + version.
- Alert routing on `status === 'error'` for ≥ 2 consecutive polls.

Out of scope:
- Mutual TLS, auth tokens, signed responses — single-user LAN deployment.
- Push-based health updates (websocket / SSE).
- Historical health charts in Backlogger itself.

---

## 3. Design

### 3.1 Contract

Home System polls `GET ${BACKLOGGER_BASE_URL}/health` every `BACKLOGGER_POLL_INTERVAL_S` (default `15`). The poll request has a 2 s timeout. Any of: HTTP `5xx`, network error, timeout, or schema-invalid body counts as `error` from Home System's perspective.

### 3.2 CORS

Currently the API enables a permissive `cors()`. We replace it with:

```ts
const allowed = (process.env.BACKLOGGER_ALLOWED_ORIGINS ?? 'http://127.0.0.1,http://localhost')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({ origin: allowed.length === 1 && allowed[0] === '*' ? true : allowed }));
```

Default keeps local dev working; a Home System install sets `BACKLOGGER_ALLOWED_ORIGINS=http://home.local`.

### 3.3 JSON Schema

`packages/api/src/health/health.schema.json` — derived from the zod `HealthSchema` via `zod-to-json-schema` at build time, served at `GET /health/schema` for the Home System client to fetch on bootstrap.

### 3.4 Home System tile (specification only)

```
┌─ Backlogger ─────────────────────────── v0.3.0 ─┐
│ status: ●OK              uptime: 3 d 4 h        │
│ ┌──────────┬──────────┬──────────┐              │
│ │ api ●OK  │ db ●OK   │ fs ●OK   │              │
│ │ tmpl ●OK │ fts ●OK  │          │              │
│ └──────────┴──────────┴──────────┘              │
│ last poll: 4 s ago                              │
└─────────────────────────────────────────────────┘
```

Colors: `ok` = green, `degraded` = amber, `error` = red.

### 3.5 Alerting policy

Alert when `status === 'error'` for ≥ 2 consecutive polls (i.e. ≥ 30 s by default). Recovery is `status === 'ok'` for 1 poll.

---

## 4. Tasks

| # | Task | Files |
|---|------|-------|
| 1 | CORS env-driven allow-list | `packages/api/src/app.ts` |
| 2 | JSON Schema generation + `/health/schema` route | `packages/api/src/health/schema-route.ts`, build step in `package.json` |
| 3 | Monitoring docs (URL, poll cadence, badge colors) | `docs/operations/monitoring.md` |
| 4 | Home System service definition + tile (separate repo) | external |
| 5 | E2E sanity: hit `/health` from a non-loopback origin in a test | `e2e/health-cors.spec.ts` |

---

## 5. Exit Criteria

- Home System dashboard shows a Backlogger tile with live subsystem badges.
- Stopping the Backlogger process flips the tile to `error` within ≤ 2 poll intervals.
- `GET /health/schema` returns a valid JSON Schema document.
- `BACKLOGGER_ALLOWED_ORIGINS=http://127.0.0.1` allows local dev; `*` opens CORS fully; anything else restricts.
- All Phase 1+2 tests still green.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Tightened CORS breaks local dev | Default allow-list includes `http://127.0.0.1` and `http://localhost`. Documented env var to override. |
| Poll storm if Home System retries aggressively on error | `/health` is cached for 2 s (Block 2); cost stays bounded. |
| Schema drift between Backlogger and Home System | Schema is published from Backlogger; Home System fetches it on bootstrap and validates every poll. |
| LAN trust assumption breaks (e.g. multi-tenant home) | Documented limitation — Phase 6 introduces real auth. Restricting CORS narrows the blast radius until then. |

---

## 7. Implementation Notes (M1 — ✅ Done, 2026-05-31)

**Delivered**: Backlogger-side surface for Home System monitoring — schema endpoint, hardened CORS contract, and operator-facing docs. 142/142 unit + 8/8 e2e passing.

### Files added
- [packages/api/src/health/schema.ts](../../../packages/api/src/health/schema.ts) — hand-authored JSON Schema (draft-07) for `HealthResponse`. Hand-rolled rather than generated to avoid pulling in `zod-to-json-schema`; the shape is small and the schema lives in the same folder as the probes so any payload change forces a co-located edit.
- [docs/operations/monitoring.md](../../operations/monitoring.md) — operator guide: endpoint contract, subsystem reference, caching, poll cadence, CORS env var, curl recipes.

### Files modified
- [packages/api/src/app.ts](../../../packages/api/src/app.ts) — new route `GET /health/schema` returns the JSON Schema with `Content-Type: application/schema+json` and `Cache-Control: public, max-age=3600`.
- [packages/api/src/app.test.ts](../../../packages/api/src/app.test.ts) — added one test for the schema route (verifying it cross-validates a live `/health` response) and three tests for the CORS allow-list (`*`, restrictive list, empty/disabled).

### Pre-existing pieces leveraged
- The CORS env-var (`BACKLOGGER_ALLOWED_ORIGINS`) and its `*` / list / empty semantics were already implemented in [packages/api/src/server.ts](../../../packages/api/src/server.ts) and [packages/api/src/app.ts](../../../packages/api/src/app.ts). This block only added tests + documentation, not the middleware itself.

### Deviations from §3 design
- **Default CORS origin**: design specified `http://127.0.0.1,http://localhost` as the default. The existing server keeps `*` so that the "open the web UI from another device on the LAN" flow keeps working out of the box. The env var lets a Home System install lock it down. Documented in [monitoring.md](../../operations/monitoring.md#cors).
- **Schema generation**: design called for `zod-to-json-schema` at build time. Since `HealthResponse` is hand-rolled in `packages/shared` (no zod schema yet) and the shape is stable, we hand-authored the JSON Schema as a plain constant. Adding a zod source + generator is a strict superset and can land later without changing the served bytes.
- **Home System side**: external to this repository and not implemented here. The Backlogger surface (`/health`, `/health/schema`, CORS env var, monitoring doc) is fully ready for the Home System tile to consume.

### Forward-compat
- Existing `App.tsx` health badge is unaffected — `/health` still returns `200/ok` for healthy installs and the badge only inspects fetch success.
- Phase 1/2 monitoring (if any) sees no breaking change: the legacy `status` field is preserved with the same value semantics on the healthy path.
