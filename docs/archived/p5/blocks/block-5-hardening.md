# Block 5 — Phase 5 Hardening

> Phase 5 / Block 5 · Parent: [../implementation_plan.md](../implementation_plan.md)
> Depends on: [Block 4 — Knowledge Graph](./block-4-knowledge-graph.md).
> Delivers: Phase 5 is releasable. CI green, perf budgets met, docs current, end-to-end
> demoable on a fresh clone.

---

## 1. Scope

Close-out work. No new user-visible features beyond polish.

- E2E coverage for the knowledge graph user flow.
- Perf bench for the knowledge graph.
- Bundle audit budget raised to 220 kB to fit the graph renderer.
- README, design overview, and roadmap updated to reflect P5.
- A 2026-MM-DD-phase-5.md status report.

## 2. Tasks

| # | Task | Files | Status |
|---|------|-------|--------|
| 1 | E2E: open graph, hover, click, document opens | `e2e/knowledge-graph.spec.ts` | ✅ |
| 2 | Bench: graph query and render | `scripts/bench-graph.ts` | ✅ |
| 3 | Bundle-audit budget bump 200 → 220 kB | `scripts/bundle-audit.ts` | ✅ |
| 4 | README: Phase 5 section | `README.md` | ✅ |
| 5 | Design overview: Phase 5 status table | `docs/design/overview.md` | ✅ |
| 6 | Status report | `docs/reports/2026-06-02-phase-5.md` | ✅ |

## 3. Performance Budgets (Phase 5)

| Metric | Budget |
|--------|--------|
| Initial JS gzip | 220 kB (+20 kB over P3) |
| `GET /api/projects/:id/graph` (1 000 docs) | ≤ 50 ms p95 |
| Graph first paint (500 nodes) | ≤ 80 ms |
| Knowledge-graph payload | ≤ 200 kB gzip |

## 4. Definition of Done

1. All P5 block exit criteria met.
2. The knowledge graph button is visible in the topbar; clicking it renders the
   seeded project under 80 ms.
3. CI green: lint, typecheck, unit, e2e (chromium).
4. README and design overview accurately describe Phase 5.

## 5. Risks

| Risk | Mitigation |
|------|------------|
| Graph layout pegs CPU on large projects | Cap rendered nodes at 1 000; show a "Filter to reduce" banner above the cap. |
