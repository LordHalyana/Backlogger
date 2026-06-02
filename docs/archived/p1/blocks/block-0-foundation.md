---
id: 092ad44e-4860-42b5-82bc-3c273cbb3ecc
title: "Block 0 — Foundation / Walking Skeleton"
project: backlogger-docs
type: design_doc
status: archived
created_at: "2026-05-30T07:02:10.068Z"
updated_at: "2026-05-30T10:02:33.202Z"
tags: ["p1"]
---

# Block 0 — Foundation / Walking Skeleton

> Parent: [../implementation_plan.md](../implementation_plan.md)
> Depends on: nothing.
> Delivers: runnable monorepo with a health-checked API and a React shell that calls it.

---

## 1. Purpose

Stand up the smallest possible end-to-end system so every later block plugs into a working pipeline. No business features.

---

## 2. Scope

In scope:
- npm workspaces monorepo at the repo root (which equals `services/backlogger/`).
- `packages/shared`, `packages/api`, `packages/web`.
- TypeScript strict config (`tsconfig.base.json`).
- Express app exposing `GET /health` → `{ status: "ok", version, uptime }`.
- React + Vite app rendering "Backlogger" and showing the live health status.
- Vite dev proxy from `/api` → `http://127.0.0.1:4317`.
- ESLint + Prettier + Vitest baseline.
- GitHub Actions CI: install → lint → typecheck → test → build.
- `.env.example`, `.gitignore` (ignoring `data/`, `node_modules/`, `dist/`).
- Base theme scaffolding: CSS variables for colors/spacing under `:root` and `[data-theme="light"]`, with **dark as the default**. No toggle yet (added in Block 3).
- Inline pre-hydration script that reads `localStorage.theme` and sets `<html data-theme>` before React mounts, preventing a flash of light content.

Out of scope: SQLite, filesystem storage, any domain models, the theme toggle UI.

---

## 3. Design

### 3.1 Workspaces

```jsonc
// package.json (root)
{
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev":       "concurrently \"npm:dev:*\"",
    "dev:api":   "npm -w @backlogger/api run dev",
    "dev:web":   "npm -w @backlogger/web run dev",
    "build":     "npm -ws --if-present run build",
    "test":      "vitest run",
    "lint":      "eslint . --max-warnings 0",
    "typecheck": "tsc -b --noEmit"
  }
}
```

### 3.2 API entrypoint

`packages/api/src/server.ts` creates an Express app, mounts a `/health` router, and listens on `BACKLOGGER_HOST:BACKLOGGER_PORT`.

### 3.3 Web entrypoint

`packages/web/src/App.tsx` fetches `/health` on mount and renders status. Uses `@tanstack/react-query` even at this stage so later blocks need no refactor.

### 3.4 CI

`.github/workflows/ci.yml` runs on push/PR:
1. `actions/setup-node@v4` with Node 20.
2. `npm ci`
3. `npm run lint`
4. `npm run typecheck`
5. `npm test`
6. `npm run build`

---

## 4. Tasks

1. Initialize root `package.json` with workspaces.
2. Scaffold `packages/shared` (empty exports + tsconfig).
3. Scaffold `packages/api` (Express + `tsx` watch + health route).
4. Scaffold `packages/web` (Vite + React + react-query).
5. Add `tsconfig.base.json` and per-package `tsconfig.json` extending it.
6. Configure ESLint (typescript-eslint, react) + Prettier + lint-staged + husky.
7. Add Vitest config at root.
8. Add GitHub Actions workflow.
9. Add `README.md` quickstart and `.env.example`.

---

## 5. Exit Criteria

- `npm install && npm run dev` boots API on `:4317` and web on `:5173`.
- Browser shows "Backlogger" plus the health payload.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all succeed locally and in CI.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Workspace tool quirks | Pin Node 20 LTS; commit `package-lock.json`. |
| Vite proxy misconfig blocks API calls | Add a smoke test that hits `/api/health` through the proxy. |

---

## 7. Implementation Notes

**Status:** ✅ Complete (M0).

### What shipped
- Root: [package.json](../../../package.json), [tsconfig.base.json](../../../tsconfig.base.json), [tsconfig.json](../../../tsconfig.json), [.gitignore](../../../.gitignore), [.env.example](../../../.env.example), [.eslintrc.cjs](../../../.eslintrc.cjs), [.prettierrc.json](../../../.prettierrc.json), [vitest.config.ts](../../../vitest.config.ts).
- `packages/shared` — `HealthStatus` type only ([src/index.ts](../../../packages/shared/src/index.ts)).
- `packages/api` — Express app with `GET /health`, `tsx watch` dev script, Supertest unit test ([src/app.ts](../../../packages/api/src/app.ts), [src/server.ts](../../../packages/api/src/server.ts), [src/app.test.ts](../../../packages/api/src/app.test.ts)).
- `packages/web` — Vite + React 18 + react-query app showing live health status. Dark theme by default via CSS variables on `[data-theme]`, with a pre-hydration inline script that reads `localStorage.theme` before React mounts to prevent a flash of light content ([index.html](../../../packages/web/index.html), [src/main.tsx](../../../packages/web/src/main.tsx), [src/App.tsx](../../../packages/web/src/App.tsx), [src/styles/theme.css](../../../packages/web/src/styles/theme.css), [src/styles/app.css](../../../packages/web/src/styles/app.css)).
- CI: [.github/workflows/ci.yml](../../../.github/workflows/ci.yml) running install → lint → typecheck → test → build on Node 20.
- [README.md](../../../README.md) quickstart.

### Deviations from the design
- **`typecheck` script uses `tsc -b` (not `tsc -b --noEmit`).** Composite project references require emit; TypeScript errors with TS6310 when a referenced project disables emit. Build artifacts land in per-package `dist/` (gitignored), so this is harmless and keeps incremental builds fast.
- **Vite proxy proxies both `/api` and `/health`** so the existing `/health` route is reachable from the web app without changing it. When Block 2 adds `/api/*`, both stay routed correctly.
- **Node version on the dev machine is 24**, but `engines` and CI are pinned to Node 20 LTS as planned.

### Verification (local)
- `npm install` — 488 packages, no errors (some moderate audit warnings from transitive deps; revisit in M6).
- `npm run typecheck` — pass.
- `npm run lint` — pass (0 warnings).
- `npm test` — 1/1 pass (`GET /health`).
- `npm run build` — pass; vite bundle ~182 KB (57 KB gzip).

### Follow-ups for later blocks
- Add a Vite-proxy smoke test (listed under Risks). Defer to M6 hardening so we don't pay the Playwright setup cost yet.
- Consider migrating ESLint to v9 flat config when the toolchain is stable; v8 is end-of-life but works.
- Audit warnings: revisit during M6.
