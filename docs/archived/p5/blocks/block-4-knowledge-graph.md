---
id: 6e6761e7-b5d8-4798-a8e5-b4bcd58fbd31
title: "Block 4 — Knowledge Graph Index & API"
project: backlogger-docs
type: design_doc
status: archived
created_at: "2026-06-01T10:07:09.808Z"
updated_at: "2026-06-02T06:56:49.391Z"
tags: ["p5"]
---

# Block 4 — Knowledge Graph Index & API

> Phase 5 / Block 4 · Parent: [../implementation_plan.md](../implementation_plan.md)
> Depends on: P2 Block 2 (Document Linking — provides the `links` table).
> Delivers: a per-project link graph with a queryable API and an interactive sidebar visualisation.

---

## 1. Problem

The `links` table from Phase 2 records every `[[wiki-link]]`, but the only views the user
gets are the per-document Backlinks panel and a flat list. There is no way to see at a
glance which documents are central, which are orphans, or how clusters of design docs
connect. For a project the size of `backlogger-docs` (31 docs and growing) this missing
view is the difference between "I have notes" and "I have a knowledge base".

## 2. Goals

1. A graph view, accessible from a topbar icon, that renders every document in the
   current project as a node and every `[[link]]` as a directed edge.
2. Node size proportional to in-degree (incoming backlinks). Orphans (degree 0) are
   visually distinct.
3. Click a node → open the document in the editor.
4. Hover a node → highlight its direct neighbours; fade everything else.
5. A search-as-you-type filter that hides non-matching nodes and their isolated
   neighbours.
6. Backend query under 50 ms for projects up to 1 000 documents; front-end render under
   80 ms for ≤ 500 visible nodes.

## 3. Non-goals

- Cross-project graph (Phase 5 stays single-project; cross-project is a P6 candidate
  once links can target other projects).
- 3D rendering.
- Editing relationships from the graph (read-only view).
- Persisting graph layout — recomputed on every open.

## 4. Data

Nothing new in SQLite. The graph is derived from `documents` + `links` joined per
project:

```sql
SELECT d.id, d.title, d.type, d.status, d.tags,
       COALESCE(in_count.n, 0)  AS in_degree,
       COALESCE(out_count.n, 0) AS out_degree
FROM documents d
LEFT JOIN (
  SELECT target_id, COUNT(*) AS n FROM links
  WHERE target_id IS NOT NULL GROUP BY target_id
) in_count  ON in_count.target_id = d.id
LEFT JOIN (
  SELECT source_id, COUNT(*) AS n FROM links GROUP BY source_id
) out_count ON out_count.source_id = d.id
WHERE d.project_id = :pid;

SELECT source_id, target_id, target_title, target_title_norm
FROM links
WHERE source_id IN (SELECT id FROM documents WHERE project_id = :pid);
```

`target_id IS NULL` (broken links) become edges to a synthetic "broken" sink node, which
renders distinctly so the user can fix them.

## 5. API

| Method | Path                              | Description |
|--------|-----------------------------------|-------------|
| `GET`  | `/api/projects/:id/graph`         | `{ nodes: GraphNode[], edges: GraphEdge[], generatedAt: string }` |

### Shapes

```ts
interface GraphNode {
  id: string;                       // document UUID, or `broken:<normalized-title>` for sinks
  kind: 'document' | 'broken';
  title: string;
  type?: DocumentType;
  status?: DocumentStatus;
  tags?: string[];
  inDegree: number;
  outDegree: number;
}

interface GraphEdge {
  sourceId: string;
  targetId: string;
  display: string;                  // the rendered link label
}
```

Cached server-side for 10 s per `projectId` via a tiny in-memory LRU; the cache is
invalidated by `LinkService.rebuildForDocument`, `documents` delete, and pull/merge
events from Block 3.

## 6. Web

### 6.1 Library choice

`@vis.gl/react-vis-graph` or `react-force-graph-2d` — both pure-Canvas with
ForceSimulation-style layouts, both under 60 kB gzipped. Decision criteria:

- No SVG (we want decent performance up to 500 nodes).
- Supports node/edge hover callbacks out of the box.
- License: MIT.

Pick at implementation time after a one-page spike; document the choice in §7 of this
block's implementation notes.

### 6.2 Component

`packages/web/src/components/KnowledgeGraph.tsx`. State:

```ts
interface GraphState {
  query: string;              // filter text
  focusId: string | null;     // hovered node
  layout: 'force' | 'radial';
}
```

The component receives `nodes` and `edges` from `useGraph(projectId)` and renders a
canvas. Nodes are coloured by type (matching `TYPE_BADGE` palette from `ProjectTree`).
Broken-link sinks render as a red ring.

### 6.3 Wiring

- New topbar button **Graph** (next to Search), only visible when a project is selected.
- Opens an overlay covering the editor pane; closes with Esc.
- Clicking a node calls `onOpenDocument(projectId, id)` and closes the overlay.

### 6.4 Filter UX

A top-of-overlay text input filters nodes by title (substring, case-insensitive) and
tags (prefix `#` matches the tag chip). Filtered-out nodes fade to 10 % opacity;
edges between two faded nodes are hidden entirely.

## 7. Tasks

| # | Task | Files | Status |
|---|------|-------|--------|
| 1 | Backend query + LRU cache | `packages/api/src/services/graph-service.ts` | ✅ |
| 2 | Cache invalidation hooks | `packages/api/src/services/document-service.ts` | ✅ |
| 3 | Route | `packages/api/src/routes/projects.ts` | ✅ |
| 4 | Web hook `useGraph(projectId)` | `packages/web/src/lib/graph.ts` | ✅ |
| 5 | `KnowledgeGraph` component | `packages/web/src/components/KnowledgeGraph.tsx` | ✅ |
| 6 | Topbar entry + overlay routing | `packages/web/src/App.tsx` | ✅ |
| 7 | Library choice notes (§11) | `docs/p5/blocks/block-4-knowledge-graph.md` | ✅ |
| 8 | Unit tests (degree counts, broken sinks, cache TTL) | `packages/api/src/services/graph-service.test.ts` | ✅ |
| 9 | E2E spec: open graph, hover a node, click → editor opens | `e2e/knowledge-graph.spec.ts` | ✅ |

## 8. Performance

- 1 000 docs / 5 000 links benchmark added to `npm run bench`.
  Budgets: backend ≤ 50 ms p95, payload ≤ 200 kB gzip, render ≤ 80 ms for 500 visible
  nodes on a 2024 mid-range laptop.
- The cache is bounded to 8 entries (8 most-recently-opened projects).

## 9. Accessibility

- The canvas is supplemented with a hidden `<ul>` listing every node + its degree, so
  screen readers and keyboard users get the same content.
- Keyboard navigation: ↑/↓ moves the focused node through the list; Enter opens.
- Esc closes the overlay.

## 10. Exit Criteria

- The seeded `backlogger-docs` graph renders in ≤ 80 ms with all 31 documents visible.
- Filtering for `phase 5` narrows the graph to the P5 cluster and its inbound neighbours.
- Clicking a node opens the document; reopening the graph reuses the cached payload
  (no network call within the 10 s TTL).
- Bench command reports both backend p95 and front-end FPS during interaction.
- 3 new unit tests + 1 new e2e spec, all green.

---

## 11. Implementation Notes — Library Choice

**Selected: `react-force-graph-2d` v1.29.1 (MIT)**

| Candidate | Renderer | Bundle (gzip) | Notes |
|-----------|----------|--------------|-------|
| `react-force-graph-2d` | Canvas | ~30 kB | MIT, built-in hover, directional arrows, wraps `force-graph@1.51.4` |
| `react-force-graph-3d` | WebGL (Three.js) | ~220 kB | Overkill; 3D ruled out in §3 non-goals |
| `@vis-gl/react-force-graph` | SVG/Canvas | not published | Pre-release; no stable release at decision date |
| `react-sigma` (Sigma.js) | WebGL | ~80 kB | Good UX but more setup for custom node shapes |

**Why `react-force-graph-2d`:**

- Canvas renderer (not SVG) meets the ≤ 80 ms render budget for 500 nodes — SVG DOM
  mutation at that scale causes layout thrashing.
- The underlying `force-graph` kapsule exposes `onNodeHover`, `onNodeClick`, and
  `nodeCanvasObject` callbacks which cover all interactive requirements without custom
  event wiring.
- Directional arrow support (`linkDirectionalArrowLength`) is built-in; no extra pass
  needed to draw edge directionality.
- `nodeVal` prop scales physics radius by in-degree, giving the hub-and-spoke visual
  naturally without a custom canvas paint function.
- MIT licence; no additional licence review required.

**Integration decisions made during implementation:**

- Types are defined inline in `packages/web/src/lib/graph.ts` (not imported from the
  API package) to avoid a cross-workspace TypeScript path dependency.
- Node colour is determined by `document.type`; orphan nodes (inDegree = 0 and
  outDegree = 0) use a muted slate colour distinct from all types.
- Broken-link sink nodes carry a `kind: 'broken'` discriminant and are rendered in
  accent-red; clicking them is a no-op (no document to open).
- Cache invalidation is driven from `DocumentService` rather than `LinkService` because
  `DocumentService` is the single write path for create / update / delete and already
  knows the `project_id` without an extra DB lookup.
