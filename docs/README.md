# Backlogger — Documentation

This is the source of truth for everything Backlogger: the original product
design, the per-phase implementation plans, the block-level design notes,
operations guides, and status reports.

## Layout

```
docs/
  README.md              # this index
  design/                # cross-phase, product-level documents
    overview.md          # original product vision and architecture
    roadmap.md           # cross-phase implementation roadmap
  phases ─ p1, p2, p3/   # one folder per phase
    implementation_plan.md
    design.md            # (p3 only — phase-scoped design doc)
    blocks/              # per-block design + §7 implementation notes
  operations/            # operator-facing guides (monitoring, etc.)
  reports/               # dated status reports
```

## Conventions

- Each phase folder is self-contained: `implementation_plan.md` is the
  hub; block files under `blocks/` carry the detailed design plus a
  `§7 Implementation Notes` section appended when the block ships.
- Status markers used in plan tables: ⏳ Not started, 🟡 In progress,
  ✅ Done.
- Cross-document links use relative paths (`../design/overview.md`,
  `./blocks/block-3-…`).
- New status reports go under `reports/` and are named
  `YYYY-MM-DD-<topic>.md`.

## Quick links

### Cross-phase
- [Product overview](design/overview.md)
- [Roadmap](design/roadmap.md)

### Phase 1 — MVP (✅ complete)
- [Plan](p1/implementation_plan.md)
- Blocks: [0 Foundation](p1/blocks/block-0-foundation.md) ·
  [1 Markdown storage](p1/blocks/block-1-markdown-storage.md) ·
  [2 Project registry](p1/blocks/block-2-project-registry.md) ·
  [3 Markdown editor](p1/blocks/block-3-markdown-editor.md) ·
  [4 Document types](p1/blocks/block-4-document-types.md) ·
  [5 Templates](p1/blocks/block-5-templates.md) ·
  [6 Hardening](p1/blocks/block-6-hardening.md)

### Phase 2 — Search · Linking · Tags · Templates · Hardening (✅ complete)
- [Plan](p2/implementation_plan.md)
- Blocks: [1 Full-text search](p2/blocks/block-1-fulltext-search.md) ·
  [2 Document linking](p2/blocks/block-2-document-linking.md) ·
  [3 Tag explorer](p2/blocks/block-3-tag-explorer.md) ·
  [4 User templates](p2/blocks/block-4-user-templates.md) ·
  [5 Hardening](p2/blocks/block-5-hardening.md)

### Phase 3 — Integration & Usability (✅ complete)
- [Design](p3/design.md)
- [Plan](p3/implementation_plan.md)
- Blocks: [1 Home system integration](p3/blocks/block-1-home-system-integration.md) ·
  [2 Expanded health](p3/blocks/block-2-expanded-health.md) ·
  [3 Markdown import](p3/blocks/block-3-markdown-import.md) ·
  [4 Markdown export](p3/blocks/block-4-markdown-export.md) ·
  [5 Help center](p3/blocks/block-5-help-center.md) ·
  [6 Project reload](p3/blocks/block-6-project-reload.md)

### Phase 4 — Dogfooding improvements (in progress)
- [Plan](p4/implementation_plan.md)
- Blocks: [1 Folder management](p4/blocks/block-1-folder-management.md)

### Operations & reports
- [Monitoring](operations/monitoring.md)
- [Status report — 2026-05-31](reports/2026-05-31-status.md)
- [Status report — 2026-06-01 · Folder management](reports/2026-06-01-folder-management.md)
