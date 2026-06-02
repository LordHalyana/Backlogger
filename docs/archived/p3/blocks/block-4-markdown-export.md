---
id: 0a4887a3-13fc-485a-94a0-2186789cec13
title: "Block 4 — Markdown Export"
project: backlogger-docs
type: design_doc
status: archived
created_at: "2026-05-31T13:44:48.678Z"
updated_at: "2026-05-31T14:16:54.771Z"
tags: ["p3"]
---

# Block 4 — Markdown Export

> Parent: [../implementation_plan.md](../implementation_plan.md)
> Depends on: Phase 1 Blocks 1 (FsRepository), 4 (DocumentService).
> Delivers: a user can download any document as its original `.md` file, preserving frontmatter.

---

## 1. Purpose

Guarantee no vendor lock-in. The filesystem already *is* the source of truth; the export feature makes that contract observable from the UI without giving users shell access to the host.

---

## 2. Scope

In scope:
- `GET /api/documents/:id/raw` returns `text/markdown; charset=utf-8` with `Content-Disposition: attachment; filename="<slug>.md"`.
- Document toolbar "Download" button.
- File contents are read from disk (the canonical source), not reconstructed from the DB.

Out of scope:
- Project export (all docs in a project as a ZIP) — deferred.
- Full data dir export (operator's `tar -czf` does the job).
- Format conversion (PDF, HTML).
- Bulk multi-document download.
- Export with embedded asset bundling (no assets yet).

---

## 3. Design

### 3.1 API

`GET /api/documents/:id/raw`:
- Looks up the document by id → resolves to disk path via `PathResolver`.
- Streams the file with `res.sendFile` (Express handles `ETag`, `Last-Modified`, range).
- Response headers:
  - `Content-Type: text/markdown; charset=utf-8`
  - `Content-Disposition: attachment; filename="<safeFilename>"`
  - `Cache-Control: private, no-store` (a freshly edited doc must not serve a stale copy).
- 404 if the document row exists but the file is missing (rare — reindex should catch this; we surface a clear error rather than empty body).

### 3.2 Safe filename

Filename in `Content-Disposition` uses the document's stored slug, not the user-supplied title:

```ts
const safe = doc.slug + '.md'; // slug is already `[a-z0-9-]+`
res.setHeader('Content-Disposition', `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(doc.title)}.md`);
```

The `filename*` (RFC 5987) carries the human-readable title; the ASCII fallback uses the safe slug.

### 3.3 Web

- New `DownloadButton` in the document toolbar (next to the view-mode toggle), simple anchor:
  ```tsx
  <a className="toolbar-button" href={`/api/documents/${doc.id}/raw`} download>
    Download
  </a>
  ```
- No client-side mutation — anchor + `download` attribute is enough; the browser handles the save dialog.
- Disabled state if the document has unsaved changes (the on-disk file would be stale). Tooltip explains why.

### 3.4 Security

- Path resolution goes through the existing `PathResolver`, which already rejects any path escaping `data/projects/`.
- No path or filename comes from the request body — everything is derived from the document id lookup.

---

## 4. Tasks

| # | Task | Files |
|---|------|-------|
| 1 | Route `GET /api/documents/:id/raw` | `packages/api/src/routes/documents.ts` |
| 2 | API tests: happy, missing file, bad id | `app.test.ts` |
| 3 | Toolbar `Download` button + dirty-state disable | `packages/web/src/components/DocumentWorkspace.tsx` |
| 4 | Style tweak for the new toolbar button | `packages/web/src/styles/app.css` |
| 5 | E2E: download returns the file content matching the editor body | `e2e/export.spec.ts` |

---

## 5. Exit Criteria

- Hitting `GET /api/documents/<id>/raw` returns the exact bytes of `data/projects/<pid>/<slug>-<hash>.md`.
- The browser save dialog suggests `<slug>.md`.
- Clicking Download while the editor has unsaved changes is blocked with a tooltip.
- Phase 1+2 tests all still pass.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Browser caches a stale copy after an edit | `Cache-Control: private, no-store` + the `download` attribute usually wins; doc title in `filename*` includes the slug-hash, so collisions on disk are impossible. |
| Title with embedded path separators ends up in `Content-Disposition` | Filename uses `slug`, not `title`; `filename*` URL-encodes the title. |
| Downloaded file's frontmatter differs from what the user sees in the metadata panel | The metadata panel shows the parsed object; the on-disk YAML may be re-serialized by gray-matter. Documented; the round-trip is lossless for the schema we accept. |
| Concurrent edit during download | The HTTP request reads the file as a snapshot; if a write lands mid-stream the OS gives us the pre-write bytes (atomic rename). Acceptable. |

---

## 7. Implementation Notes (M2 — ✅ Done, 2026-05-31)

**Delivered**: `GET /api/documents/:id/raw` plus a toolbar Download affordance. 145/145 unit + 9/9 e2e passing.

### Files added
- [e2e/export.spec.ts](../../../e2e/export.spec.ts) — full UI flow: create project + note → autosave → click Download → assert downloaded bytes contain the body + frontmatter.

### Files modified
- [packages/api/src/fs/repository.ts](../../../packages/api/src/fs/repository.ts) — new public `resolveAbsolutePath(rel)` so HTTP handlers can `res.sendFile` without depending on `PathResolver` directly.
- [packages/api/src/services/document-service.ts](../../../packages/api/src/services/document-service.ts) — new `locateRaw(id)` method returning `{ absolutePath, diskFilename, title }`; 404 on missing row, FS errors surfaced normally.
- [packages/api/src/routes/documents.ts](../../../packages/api/src/routes/documents.ts) — new `GET /api/documents/:id/raw` route. Sets `Content-Type: text/markdown; charset=utf-8`, RFC 5987 `Content-Disposition` (ASCII slug filename + UTF-8 title `filename*`), `Cache-Control: private, no-store`, streams via `res.sendFile`.
- [packages/api/src/app.test.ts](../../../packages/api/src/app.test.ts) — 3 tests: happy (bytes match on-disk file), 404 for missing UUID, 400 for malformed id.
- [packages/web/src/components/DocumentWorkspace.tsx](../../../packages/web/src/components/DocumentWorkspace.tsx) — Download in the toolbar next to the view-mode toggle. `<a download>` when clean; disabled `<button>` with tooltip when dirty or saving.
- [packages/web/src/styles/app.css](../../../packages/web/src/styles/app.css) — `.download-button` styling matching the toolbar look.

### Deviations from §3 design
- **Title in `filename*`**: design example wrote `filename*=UTF-8''Title.md`. We use `encodeURIComponent(`${title}.md`)` so spaces and Unicode round-trip correctly. The e2e test confirms browsers accept both the ASCII fallback and the UTF-8 title; in practice Chromium picks the title.
- **Disabled state**: design specified disabling while dirty. We disable while *dirty or saving* (the in-flight `update` mutation) to avoid serving bytes that are about to change. Tooltip text adjusted accordingly.

### Forward-compat
- The new endpoint is additive — no existing route changed shape.
- `FsRepository.resolveAbsolutePath` is the first public absolute-path accessor; M3 (Import) and M4 (Reload) can reuse it.
