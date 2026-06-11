# Overengineering Analysis

## Summary

Backlogger mostly avoids overengineering. It uses plain CSS, Express routes, SQLite, Markdown files, and small shared schemas. The main overengineering risk is adding broad systems for future possibilities instead of solving the assignment's concrete need: mount docs folders, index them, and display them reliably. The cleanup direction should be smaller, not bigger.

## Findings

### Finding 1: Mounted-docs support does not need a plugin system

**Priority:** High  
**Assignment relevance:** Required  
**Location:** `docs/operations/data-storage.md`, `packages/api/src/server.ts`, `packages/api/src/services/reindex-service.ts`

**Problem:**  
The natural temptation is to solve external project docs with providers, plugins, sync engines, or import adapters. The current filesystem model already supports mounting a folder at the project boundary.

**Why it matters:**  
The assignment asks for realistic mounted docs behavior. A large extension architecture would delay the simple fix: index normal Markdown and make mounted projects safe to browse.

**Suggested fix:**  
Implement the smallest path: project-root mount, frontmatterless read-only indexing, skipped-file visibility, and optional adoption. Defer plugins, connectors, and remote sync.

**Status:**  
Addressed on 2026-06-09. Frontmatterless indexing, project-level read-only mode with an editable toggle, UI indicators, skipped-file alerts, and first-edit adoption are implemented without introducing plugins, providers, or a sync engine.

**Risk:**  
If future requirements include remote Git hosting or multi-user permissions, the simple mount model may need extension. That is not a reason to build it now.

---

### Finding 2: Do not replace React Query with global client state

**Priority:** Medium  
**Assignment relevance:** Helpful  
**Location:** `packages/web/src/lib/query-keys.ts`, `packages/web/src/lib/*.ts`, `packages/web/src/App.tsx`

**Problem:**  
React Query already handles server state well. Some cache invalidation is scattered, but that does not justify adding Redux, Zustand, or a custom event bus.

**Why it matters:**  
Adding another state layer would make simple CRUD and reload flows harder to debug. The current problem is naming and centralizing invalidation, not state management capacity.

**Suggested fix:**  
Keep React Query. Add a few domain-specific invalidation helpers and use them consistently.

**Status:**  
Addressed on 2026-06-09. Query keys and project/document invalidation helpers are centralized in `packages/web/src/lib/query-keys.ts`; no new state library was added.

**Risk:**  
Over-centralizing cache helpers can make harmless mutations refetch too much. Keep helpers specific.

---

### Finding 3: Health checks and benchmarks are enough for this app

**Priority:** Low  
**Assignment relevance:** Optional  
**Location:** `packages/api/src/health/*`, `scripts/bench-search.ts`, `scripts/bench-graph.ts`, `docs/operations/monitoring.md`

**Problem:**  
The app has health probes and simple benchmarks. It does not need distributed tracing, metrics storage, or a dashboard for the assignment.

**Why it matters:**  
Backlogger is a self-hosted single-user app. Operational complexity should stay proportional to deployment complexity.

**Suggested fix:**  
Keep `/health`, existing scripts, and concise docs. Improve error messages and skipped-file reports before adding observability features.

**Risk:**  
If deployments become multi-user or production-critical, this may be insufficient. That is outside current scope.

---

### Finding 4: A full design system would be excessive

**Priority:** Low  
**Assignment relevance:** Optional  
**Location:** `packages/web/src/styles/theme.css`, `packages/web/src/styles/app.css`, `docs/design/ui-conventions.md`

**Problem:**  
The UI could be made more consistent, but adopting a component library or design-system package would be larger than the current need.

**Why it matters:**  
A new UI dependency would affect bundle size, styling conventions, tests, and all components. The current app only needs better organization and a few consistent patterns.

**Suggested fix:**  
Continue with CSS variables and plain components. Extract shared controls only where repeated behavior exists.

**Status:**  
Addressed incrementally on 2026-06-09. Theme tokens, modal/graph CSS splitting, and the small `ModalActions` wrapper improved consistency without introducing a component library.

**Risk:**  
Plain CSS can drift if not organized. Split CSS by feature gradually if needed.

---

### Finding 5: Avoid a generic document metadata engine

**Priority:** Medium  
**Assignment relevance:** Required  
**Location:** `packages/shared/src/documents.ts`, `packages/api/src/services/reindex-service.ts`, `packages/api/src/services/document-service.ts`

**Problem:**  
Frontmatterless indexing could lead to a highly generic metadata resolution engine with multiple sources, precedence layers, and plugin hooks.

**Why it matters:**  
The assignment needs mounted docs to display. It does not need every possible Markdown metadata convention.

**Suggested fix:**  
Use a clear two-mode model: Backlogger frontmatter if present and valid; otherwise derived metadata from file path, heading, and file stats. Project read-only mode decides whether derived files can be adopted on first edit. Document the precedence rules.

**Status:**  
Addressed on 2026-06-11. Reindex now supports Backlogger-authored Markdown and plain Markdown with derived metadata. Editable projects can adopt derived files on first save; read-only projects keep mounted docs protected. API tests cover frontmatterless indexing, first-edit adoption, and read-only blocking without adding a generic metadata engine.

**Risk:**  
Some Markdown ecosystems use their own frontmatter. The simple model may ignore useful fields, but that is acceptable until a real need appears.

---

## Recommended Action Plan

1. Immediate fixes: verify the mounted-docs read-only/adoption path and keep cache invalidation centralized.
2. Next cleanup pass: keep adoption behavior covered when update/archive flows change.
3. Optional improvements: reorganize CSS and tests without new frameworks.

## What Not To Do

- Do not build plugins, providers, sync engines, or metadata pipelines for this assignment.
- Do not add another frontend state library.
- Do not adopt a design system package.
- Do not turn benchmarks into a monitoring platform.
- Do not generalize before the mounted-docs workflow works end to end.
