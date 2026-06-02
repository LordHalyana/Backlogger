# Phase 4 — Implementation Plan

> Parent: [../design/roadmap.md](../design/roadmap.md)
> Predecessor: [../p3/implementation_plan.md](../p3/implementation_plan.md) — Phase 3 (✅ complete, 169 unit + 13 e2e tests).
> Scope: opportunistic improvements driven by dogfooding. Not a planned
> capability phase; blocks are added here as concrete needs surface.

---

## 1. Objective

Address rough edges discovered while using Backlogger to manage its
own documentation, without breaking the P1–P3 contract that the
filesystem is the source of truth.

## 2. Block list

| # | Block               | Design Doc                                                         | Status |
|---|---------------------|--------------------------------------------------------------------|--------|
| 1 | Folder Management   | [block-1-folder-management.md](./blocks/block-1-folder-management.md) | ✅ Done |

## 3. Rationale

Phase 3 shipped a fully-functional integrated documentation platform,
but the on-disk layout was hard-coded to five `DOCUMENT_TYPE_TO_SUBDIR`
buckets. The first attempt to seed the real repo docs as a project
exposed the limitation: real projects want a project-shaped hierarchy
(`phases/p3/blocks/`, `design/`, `reports/`), not five generic
folders. Folder Management decouples on-disk grouping from the
metadata `type` and lets users create/delete arbitrary nested
folders from the sidebar.
