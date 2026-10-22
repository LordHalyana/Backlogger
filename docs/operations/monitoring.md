---
id: d3089431-cc44-4ce1-8855-06dd0e259c18
title: "Monitoring Backlogger"
project: backlogger-docs
type: note
status: active
created_at: "2026-05-31T14:09:57.981Z"
updated_at: "2026-05-31T14:12:13.850Z"
tags: ["operations"]
---

# Monitoring Backlogger

Single-user LAN deployment. Backlogger exposes one read-only HTTP endpoint for external monitoring (e.g. Home System).

## Endpoint

`GET /health` → JSON, no auth.

| HTTP status | Aggregate `status` | Meaning |
|-------------|--------------------|---------|
| `200`       | `ok`               | All subsystems healthy. |
| `200`       | `degraded`         | At least one subsystem in a soft-fail state (e.g. data dir not writable but readable, fewer templates than expected). The app still works for most flows. |
| `503`       | `error`            | At least one hard failure (DB closed, FTS table missing, data dir unreachable). |

The aggregate `status` is `worst(api, database, storage, templates, fts)` using the ordering `ok < degraded < error`.

## Response shape

```jsonc
{
  "status":    "ok",         // SubsystemState — worst of the five subsystems
  "api":       "ok",
  "database":  "ok",
  "storage":   "ok",
  "templates": "ok",
  "fts":       "ok",
  "version":   "0.3.0",
  "uptime":    1234.567,     // seconds (float)
  "uptime_s":  1235,         // seconds (integer, snake_case convenience field)
  "checked_at": "2026-05-31T16:08:00.000Z"
}
```

The machine-readable JSON Schema lives at `GET /health/schema` (`application/schema+json`, cached for 1 h). Monitoring clients should fetch it on bootstrap and validate every poll.

## Subsystem reference

| Subsystem  | `ok` means | `degraded` means | `error` means |
|------------|------------|------------------|---------------|
| `api`      | The HTTP layer is serving requests. Always `ok` when a response comes back. | — | — |
| `database` | `SELECT 1` succeeded against SQLite. | — | The DB handle is closed or rejected the query. |
| `storage`  | `BACKLOGGER_DATA_DIR` exists, is readable, and is writable (write/unlink of a hidden `.health-probe` succeeded at the data-dir root). | Stat succeeded but the probe write failed (read-only filesystem). | `stat()` failed — directory missing or unreadable. |
| `templates`| ≥ 5 templates loaded into the registry. | < 5 templates loaded. | The registry threw on `list()`. |
| `fts`      | `SELECT count(*) FROM search_fts` succeeded. A count of `0` is healthy. | — | The FTS table is missing or the query failed. |

## Caching

The endpoint serves a snapshot cached for 2 s. Polling more frequently than 2 s costs the same as polling at 2 s.

## Polling recommendation

- Interval: 15 s.
- Timeout: 2 s.
- Alert policy: `status === 'error'` for ≥ 2 consecutive polls. Recovery: 1 healthy poll.

## CORS

Controlled by `BACKLOGGER_ALLOWED_ORIGINS` (comma-separated). Defaults to `*` (reflect any origin) to keep "access from another device on the LAN" working out of the box. Lock down to a known monitoring origin in production:

```bash
BACKLOGGER_ALLOWED_ORIGINS=http://home.local
```

The endpoint itself is always reachable (no auth, no origin gate); CORS only controls whether browser JS on a different origin can read the response.

## Curl examples

```bash
# Quick check
curl -fsS http://127.0.0.1:3333/health | jq .

# Just the aggregate state, e.g. for a shell-side `until` loop
curl -fsS http://127.0.0.1:3333/health | jq -r .status

# Fetch and pretty-print the schema
curl -fsS http://127.0.0.1:3333/health/schema | jq .
```
