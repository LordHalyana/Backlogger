# Phase 5 — Implementation Plan

> Parent: [../design/roadmap.md](../design/roadmap.md)
> Predecessor: [../p4/implementation_plan.md](../p4/implementation_plan.md) — Phase 4 (✅ complete).
> Scope: a knowledge graph derived from the existing `links` table. Multi-user and AI remain explicitly deferred to P6 and P7.

---

## 1. Objective

Make Backlogger's document relationships **visually navigable** without breaking the
P1–P4 contract that the filesystem is the source of truth.

- The wiki-link graph is rendered as an interactive panel so users can see how their
  documents connect.

> **Note:** Git integration was scoped out of Phase 5. Durable remote history is a
> candidate for a dedicated phase once the single-user product is fully stabilised.

---

## 2. Block Breakdown

| # | Block                          | Design Doc                                                             | Depends on |
|---|--------------------------------|------------------------------------------------------------------------|------------|
| 4 | Knowledge Graph Index & API    | [block-4-knowledge-graph.md](./blocks/block-4-knowledge-graph.md)      | P2 Block 2 |
| 5 | Phase 5 Hardening              | [block-5-hardening.md](./blocks/block-5-hardening.md)                  | Block 4    |

> Build order: 4 → 5.

---

## 3. Milestones

| Milestone | Block | Status         | Deliverable |
|-----------|-------|----------------|-------------|
| M0        | 4     | ✅ Done         | `GraphService` (SQL aggregation + 10 s LRU cache), `GET /api/projects/:id/graph`, `KnowledgeGraph` canvas overlay with filter, hover-highlight, and click-to-open. 10 unit + 5 integration tests green. |
| M1        | 5     | ✅ Done         | E2E suite (9 specs, all green); graph query bench p95=6.91 ms (≤ 50 ms); bundle 194 kB gzip (≤ 220 kB); README and design overview updated. |

---

## 4. Cross-Cutting Concerns

- **Knowledge graph is derived.** Like FTS and the links table, the graph is rebuilt from
  the source of truth (the existing `links` table) and never persisted as its own truth.

---

## 5. Definition of Done (Phase 5)

1. Both blocks meet their per-block exit criteria.
2. Knowledge graph renders for the seeded `backlogger-docs` project in ≤ 80 ms.
3. CI: lint, typecheck, unit, e2e all green. Initial JS gzip ≤ 220 kB (+ 20 kB budget
   over Phase 3 for the graph renderer).

---

## 6. Out of Scope (P5)

- Git integration (scrapped; deferred indefinitely).
- Multi-author / multi-user awareness (P7).
- Persisting the graph as its own data store.
