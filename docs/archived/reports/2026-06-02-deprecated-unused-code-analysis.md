---
id: 56d74f27-db18-4053-8151-f26c3484db99
title: Deprecated and Unused Code Analysis
project: backlogger-docs
type: finding
status: active
created_at: '2026-06-02T00:00:00.000Z'
updated_at: '2026-06-02T00:00:00.000Z'
tags: ["analysis", "cleanup", "maintainability"]
---

# Deprecated and Unused Code Analysis

> Project: backlogger-docs
> Created: 2026-06-02

---

## Purpose

This report identifies deprecated, unused, legacy, or likely stale code paths.
The intent is to remove confusion while preserving backwards compatibility
where the app still relies on it.

---

## Key Principles Applied

| Principle | How it applies here |
|-----------|---------------------|
| YAGNI | Remove stale code when it no longer serves current requirements. |
| KISS | Prefer fewer modes and fewer legacy paths. |
| Assignment Focus | Keep compatibility only when current data or docs need it. |
| Professional Quality | Avoid leaving known-deprecated notes unresolved. |
| Maintainability | Make active behavior distinguishable from historical behavior. |

---

## Findings

### 1. Type-based default folders are legacy behavior

Files:

- `packages/shared/src/documents.ts`
- `packages/api/src/services/document-service.ts`

`DOCUMENT_TYPE_TO_SUBDIR` maps document types to folders. The service now
supports explicit folder placement and treats the type mapping as a fallback.

Status:

Not unused. It is active backwards-compatible behavior.

Risk:

It can confuse future contributors because folder placement is now user-driven,
but type-to-folder placement still happens when no folder is supplied.

Recommendation:

Keep it for now. Document it clearly as a compatibility default. Consider
removing it only after a migration plan changes "Default (by type)" to a
single explicit default folder.

Priority: Low.

---

### 2. Native dialog references should be considered deprecated

File: `packages/web/src/components/ProjectTree.tsx`

Native folder dialogs remain despite earlier docs describing modal-based
`prompt`/`confirm` as the hardened direction.

Status:

Active code, but deprecated by project direction.

Recommendation:

Replace with `useDialog` and then update archived or current docs if they claim
no native prompts remain.

Priority: High.

---

### 3. `ThemeToggle` appears underused

Files:

- `packages/web/src/components/ThemeToggle.tsx`
- `packages/web/src/App.tsx`
- `packages/web/src/components/SettingsDialog.tsx`

`ThemeToggle` exists, but `App` routes theme changing through
`SettingsDialog`. If no active import uses `ThemeToggle`, it is likely stale.

Status:

Likely unused component.

Recommendation:

Confirm with `rg "ThemeToggle" packages/web/src`. If unused, remove it or use
it inside `SettingsDialog`. Do not keep duplicate theme controls.

Priority: Medium.

---

### 4. Graph type colors include non-schema type names

File: `packages/web/src/components/KnowledgeGraph.tsx`

`TYPE_COLOURS` includes `decision` and `design`, while shared document types
include `design_doc` and do not include `decision`.

Status:

Likely stale or mismatched display metadata.

Risk:

Graph legend can show document types that cannot exist, while real types fall
back to default colors.

Recommendation:

Align graph colors with `DocumentTypeSchema`:

- `idea`
- `note`
- `design_doc`
- `implementation_plan`
- `backlog_item`
- `finding`

Priority: High.

---

### 5. Docs contain stale phase statements

Files:

- `docs/archived/reports/*`
- `docs/archived/p*/**/*.md`

Archived docs are expected to be historical, but some current docs and reports
may still refer to knowledge graphs as future or non-goal while the code has a
graph feature.

Status:

Archived historical docs should stay archived. Current docs should be aligned.

Recommendation:

Do not rewrite archived docs unless they are being republished. Update active
docs only when the mismatch affects users or reviewers.

Priority: Low.

---

### 6. Deprecated Vite glob syntax is mentioned historically

File: `docs/archived/p3/blocks/block-5-help-center.md`

The docs mention Vite 5 deprecating `as: 'raw'`. This is historical context,
not active deprecated code.

Recommendation:

No action unless active code still uses deprecated glob syntax.

Priority: Low.

---

## Recommended Verification Commands

Run these before removing anything:

```powershell
rg "ThemeToggle" packages/web/src
rg "TYPE_COLOURS|decision|design_doc" packages/web/src packages/shared/src
rg "window\.(prompt|confirm|alert)" packages/web/src
rg "@deprecated|deprecated|TODO|FIXME" packages scripts docs
```

---

## Recommended Next Steps

1. Replace native folder dialogs.
2. Align graph type colors with shared document types.
3. Remove or reuse `ThemeToggle`.
4. Keep type-based folders documented as compatibility behavior.
5. Leave archived historical docs alone unless they are copied back into active
   docs.

---

## What Not To Do

- Do not remove compatibility folder defaults without a migration plan.
- Do not treat archived docs as active requirements.
- Do not delete code solely because it is small; delete it when it is unused or
  misleading.

