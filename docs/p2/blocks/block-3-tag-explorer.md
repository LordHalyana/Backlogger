# Block 3 — Tag Explorer

> Parent: [../implementation_plan.md](../implementation_plan.md)
> Depends on: P1 Blocks 3 (editor) and 4 (documents).
> Delivers: a normalized tag index, tag counts per project / globally, and a sidebar tag explorer that filters the document tree.

---

## 1. Purpose

Tags already live in frontmatter and survive every write, but right now they're invisible until you open a doc. Make them browseable: see every tag in a project, see how many documents carry each, click to filter.

---

## 2. Scope

In scope:
- Tag normalization: trim, lowercase, kebab-case (`Foo Bar` → `foo-bar`), enforce `^[a-z0-9][a-z0-9-]{0,49}$`.
- `tags` and `document_tags` tables built from frontmatter on every write and on reindex.
- `GET /api/tags?projectId?` → `[{ tag, count }]` ordered by count desc, then alphabetically.
- `GET /api/projects/:id/documents?tag=foo&tag=bar` filter (AND semantics).
- Sidebar "Tags" section under the existing document tree with counts and click-to-filter.
- Active filter chips above the document tree with an "Clear filters" affordance.
- Tag entry on the existing `MetadataPanel` validates the same rules client-side and shows a single inline error.

Out of scope:
- Tag rename / merge UI.
- Tag colors / pinning.
- Hierarchical / nested tags.

---

## 3. Design

### 3.1 Normalization

`packages/shared/src/tags.ts`:

```ts
export const TagSchema = z.string()
  .transform((s) => s.trim().toLowerCase().replace(/\s+/g, '-'))
  .refine((s) => /^[a-z0-9][a-z0-9-]{0,49}$/.test(s),
          'tags must be kebab-case (1–50 chars)');
export function normalizeTags(input: string[]): string[] {
  return Array.from(new Set(input.map((t) => TagSchema.parse(t))));
}
```

Applied:
- In `FrontmatterSchema` (Phase 1) — replace the existing tag rule with `TagSchema`.
- In `DocumentService.create/update` before writing.
- In the reindex loader before insert.

### 3.2 Schema

Migration `migrations/0005_tags.sql`:

```sql
CREATE TABLE tags (
  tag TEXT PRIMARY KEY
);

CREATE TABLE document_tags (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL REFERENCES tags(tag) ON DELETE CASCADE,
  PRIMARY KEY (document_id, tag)
);
CREATE INDEX idx_document_tags_tag ON document_tags(tag);
```

Triggers / repo hooks:
- On `documents` insert/update, rebuild rows in `document_tags` from the canonical frontmatter list.
- `tags` table is upsert-on-write; rows are never deleted on document removal (a Phase 3 vacuum job removes orphaned tags).

### 3.3 API

- `GET /api/tags?projectId?` — joins `document_tags` ↔ `documents`, returns `[{ tag, count }]`.
- `GET /api/projects/:id/documents?tag=foo&tag=bar` — extends existing handler; multiple `tag` query params AND together.
- All endpoints reject any `tag` value that fails `TagSchema` with 400 `INVALID_TAG`.

### 3.4 Web

- `packages/web/src/lib/tags.ts` — `useTags(projectId?)`, `useFilteredDocuments(projectId, tags)`.
- `packages/web/src/components/TagExplorer.tsx` — collapsible sidebar section under `ProjectTree`. Lists tag chips with counts. Click toggles inclusion in `selectedTags` state held by `App.tsx`.
- `packages/web/src/components/TagChips.tsx` — chip element reused by Explorer, filter bar, and MetadataPanel.
- `ProjectTree` reads `selectedTags` and switches to the filtered hook when non-empty; otherwise behaves as today.
- `MetadataPanel` tag input applies `TagSchema` on blur / Enter; shows inline error for invalid values; auto-formats `Foo Bar` → `foo-bar` and prevents duplicates.

### 3.5 Reindex

`ReindexService` already rebuilds `documents`. Add a final pass that truncates `document_tags` and reinserts from each document's normalized tags. `tags` table is upserted per row.

---

## 4. Tasks

| # | Task | Files |
|---|------|-------|
| 1 | `TagSchema` + `normalizeTags` | `packages/shared/src/tags.ts`, tests |
| 2 | Migration `0005_tags.sql` + repo hooks | `migrations/0005_tags.sql`, `db/documents-repo.ts` |
| 3 | `TagsService` + reindex integration | `services/tags-service.ts`, `services/reindex-service.ts` |
| 4 | `GET /api/tags` + filtered `documents` route | `routes/tags.ts`, `routes/documents.ts` |
| 5 | `useTags`, `useFilteredDocuments` | `packages/web/src/lib/tags.ts` |
| 6 | `TagExplorer`, `TagChips`, filter chip bar | `packages/web/src/components/` |
| 7 | `MetadataPanel` tag-input rewrite | `components/MetadataPanel.tsx` |

---

## 5. Exit Criteria

- A document with frontmatter `tags: [Foo, "foo", "Foo Bar"]` is persisted as `["foo", "foo-bar"]` (deduplicated).
- `GET /api/tags?projectId=demo` returns counts that exactly equal `SELECT tag, COUNT(*) FROM document_tags JOIN documents USING (document_id) WHERE project_id='demo' GROUP BY tag`.
- Sidebar tag chip click filters the tree; "Clear filters" restores it.
- Invalid tag in the metadata input shows the error and blocks save.
- `npm run typecheck && npm run lint && npm test && npm run build` green.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Existing Phase-1 docs have non-normalized tags | Startup reindex normalizes everything; document migration step in README. |
| Tag explosion (dozens of tags) crowds the sidebar | Section is collapsible and shows the top 20 by count; "Show all" reveals the rest. |
| `document_tags` consistency with frontmatter | Single source of truth is the frontmatter on disk; rebuilt by reindex; integration test rebuilds and diffs row sets. |

---

## 7. Implementation Notes

**Status:** ✅ Shipped

### What shipped
- `packages/shared/src/tags.ts` — `TagSchema` (kebab-case transform + 1–50 char refine) and `normalizeTags` (deduplicates silently dropping schema failures).
- `migrations/0005_tags.sql` — `tags` and `document_tags` tables with `ON DELETE CASCADE` and a covering index on `tag`.
- `packages/api/src/services/tags-service.ts` — `TagsService` with `rebuildForDocument`, `list`, and `truncate`; plugged into `DocumentService` and `ReindexService` via optional deps; wired in `context.ts`.
- `packages/api/src/routes/tags.ts` — `GET /api/tags?projectId=`; `parseTagParams` helper used by the documents list route to validate `?tag=` query params.
- `packages/api/src/db/documents-repo.ts` — `listByProjectAndTags` with AND semantics via subquery count.
- `packages/web/src/lib/tags.ts` — `useTags` and `useFilteredDocuments` React Query hooks.
- `packages/web/src/components/TagChip.tsx` — chip with optional count badge, active state, and remove button.
- `packages/web/src/components/TagExplorer.tsx` — sidebar section with top-20 default + show-all toggle.
- `packages/web/src/components/MetadataPanel.tsx` — chip-based tag input; Enter/comma/blur commits; `TagSchema` validates with inline error on failure; existing tags rendered as removable chips.
- `packages/web/src/components/ProjectTree.tsx` — accepts `selectedTags` prop; switches to `useFilteredDocuments` when non-empty; shows a filter bar with active chips and a Clear button.
- `packages/web/src/App.tsx` — `selectedTags` state, `toggleTag` function, `TagExplorer` mounted in `.project-sidebar`, tags cleared on project switch.
- CSS — `.tag-chip*`, `.tag-explorer*`, `.tag-filter-bar*`, `.tag-input-row`, `.tag-error` added to `app.css`.

### Deviations from design
- MetadataPanel: chip-based input (one-at-a-time commit via Enter/comma/blur) instead of a plain text field with comma splitting — more robust validation UX.
- `parseTagParams` is in `routes/tags.ts` (shared between the tags router and the documents router) rather than inline in documents router.

### Verification
- Build: `tsc -b` clean across all three packages.
- Tests: **126/126 green** (+7 new Tag API tests covering normalization, dedup, counts, AND filtering, 400 on invalid tag, CASCADE delete, and reindex consistency).
- Bundle gzip: **127.57 kB** initial chunk (budget 200 kB ✅).

### Follow-ups
- CodeMirror autocomplete could suggest existing project tags inside frontmatter `tags:` YAML arrays.
- A "remove all" button on the filter bar for power users with many active tag filters.
