# Documentation Cleanup Analysis

## Summary

The docs folder has improved, but it still mixes current guidance, historical plans, generated/template content, operations guides, and assignment review artifacts. The main cleanup goal is to make the current path obvious: how the app works now, how to run it, how data storage works, and what cleanup is assignment-relevant. Historical and speculative content should stay clearly labeled or archived.

## Findings

### Finding 1: Current docs and historical docs are still close together

**Priority:** Medium  
**Assignment relevance:** Helpful  
**Location:** `docs/design/roadmap.md`, `docs/archived/README.md`, `docs/archived/backlogger_revised_roadmap.md`

**Problem:**  
The roadmap document previously kept historical implementation-plan content under `docs/design`. Archived docs are labeled, but they include broad old plans that can look current when found through search.

**Why it matters:**  
Assignment reviewers and future contributors need to quickly identify current behavior. Stale roadmap details can cause unnecessary implementation work.

**Suggested fix:**  
Create a short active `docs/design/current-roadmap.md` or replace `docs/design/roadmap.md` with current priorities. Move the long original plan fully into `docs/archived/`.

**Status:**  
Addressed on 2026-06-09. `docs/design/roadmap.md` now contains current priorities and links to active architecture, derived-data, storage, and API references. `docs/README.md` now acts as the current documentation index, separates active design/operations docs from temporary cleanup reports, and points archived phase plans to `docs/archived/`. `docs/design/overview.md` now carries a historical-context warning before its original product-design content.

**Risk:**  
Moving files can break relative links and Backlogger document paths. Keep stable paths where possible, update links, and run a docs link scan.

---

### Finding 2: Data storage docs should become the mounted-docs reference

**Priority:** High  
**Assignment relevance:** Required  
**Location:** `docs/operations/data-storage.md`, `README.md`, `docs/operations/deployment.md`, `docs/operations/backup-restore.md`

**Problem:**  
The new storage doc explains the mount model, but related details still appear in README, deployment, backup/restore, security, scripts, and derived-data docs.

**Why it matters:**  
Mounted docs are a core assignment direction. Users should have one canonical document for storage paths, mount rules, indexing behavior, and limitations.

**Suggested fix:**  
Keep `docs/operations/data-storage.md` as the source of truth. Other docs should link to it and keep only short context-specific notes.

**Status:**  
Addressed on 2026-06-09 for the active operations/design docs. README, deployment, backup/restore, derived-data, API, testing, and roadmap docs now point to or align with `docs/operations/data-storage.md` for mounted-project storage, plain Markdown indexing, read-only mode, and first-edit adoption behavior.

**Risk:**  
If the storage doc becomes too long, readers may skip it. Keep examples practical and move deep design rationale to `docs/design/derived-data.md`.

---

### Finding 3: API docs should mention reload skipped-file behavior

**Priority:** Medium  
**Assignment relevance:** Required  
**Location:** `docs/api.md`, `packages/api/src/services/reindex-service.ts`, `packages/api/src/routes/projects.ts`, `packages/api/src/routes/admin.ts`

**Problem:**  
The API docs mention reindex and reload, but mounted-doc users need to know the response includes skipped files and why files can be skipped.

**Why it matters:**  
Skipped-file reporting is how users diagnose why mounted docs do not appear. If the API doc omits it, clients and UI work may ignore it too.

**Suggested fix:**  
Update `docs/api.md` with reload/reindex responses that explain when `skipped` is empty because Backlogger repaired missing or mismatched metadata, and when a file can still be skipped because it cannot be assigned to a valid project folder.

**Status:**  
Addressed on 2026-06-11. `docs/api.md` now documents project reload and full reindex responses, including the current no-skip behavior for plain Markdown, malformed frontmatter, and mismatched project frontmatter. The UI still surfaces skipped files after manual reload/reindex if a file cannot be assigned to a valid project.

**Risk:**  
API examples can drift. Keep them minimal and aligned with TypeScript interfaces in `ReindexService`.

---

### Finding 4: Testing docs correctly call out large API tests but should tie to cleanup priorities

**Priority:** Low  
**Assignment relevance:** Helpful  
**Location:** `docs/testing.md`, `packages/api/src/app.test.ts`

**Problem:**  
`docs/testing.md` notes that `app.test.ts` is large and should be split opportunistically. It does not connect that guidance to current cleanup priorities like mounted docs, reload, and frontmatterless indexing.

**Why it matters:**  
Tests should follow risk. If mounted docs become assignment-critical, test docs should point maintainers toward reload/indexing coverage first.

**Suggested fix:**  
Add a short note that storage/mount/indexing changes should be covered in API reload/reindex tests and, where relevant, e2e smoke flows.

**Status:**  
Addressed on 2026-06-09. `docs/testing.md` now calls out mounted-doc indexing, first-edit adoption, skipped-file reporting, project read-only write blocking, and cache invalidation as the priority areas for storage/reload test coverage.

**Risk:**  
Over-prescriptive testing docs can become stale. Keep it as a risk-based guideline, not a fixed test matrix.

---

### Finding 4a: Help content frontmatter parsing was too line-ending sensitive

**Priority:** Low  
**Assignment relevance:** Helpful  
**Location:** `packages/web/src/help/index.ts`, `packages/web/src/help/*.md`

**Problem:**  
The help drawer expects every bundled help Markdown file to include `slug`, `title`, and `order` frontmatter. The parser only recognized LF delimiters, so a CRLF working copy could make valid help files look invalid and crash the app before the page rendered.

**Why it matters:**  
This is a documentation-driven startup path. A help document with valid metadata should not blank the app because of platform line endings.

**Suggested fix:**  
Keep the simple parser, but accept both LF and CRLF frontmatter delimiters and add a regression test for CRLF help frontmatter.

**Status:**  
Addressed on 2026-06-09. `parseFrontmatter` now supports LF and CRLF help files, and `packages/web/src/help/index.test.ts` covers both cases.

**Risk:**  
The parser is intentionally minimal and still only supports simple scalar frontmatter. Do not expand it into a full YAML dependency unless help metadata becomes more complex.

---

### Finding 5: Analysis files should be treated as temporary review artifacts

**Priority:** Medium  
**Assignment relevance:** Required  
**Location:** `docs/01_duplicated_code_analysis.md` through `docs/08_documentation_cleanup.md`

**Problem:**  
These analysis files are intentionally created for cleanup review. They are useful now, but they will become stale as fixes land.

**Why it matters:**  
Stale analysis docs can be worse than no analysis because they point to already-fixed issues or outdated priorities.

**Suggested fix:**  
After the assignment cleanup pass, either update these files with completed status, move them to `docs/archived/`, or delete them if they are no longer required as deliverables.

**Status:**  
Addressed on 2026-06-09 with `docs/analysis-lifecycle.md`, which documents that the eight top-level analysis files are temporary assignment review artifacts and should be updated, archived, or removed after the cleanup pass.

**Risk:**  
Removing them before review may lose useful assignment evidence. Archive rather than delete if uncertain.

---

## Recommended Action Plan

1. Immediate fixes: keep `docs/operations/data-storage.md` and `docs/api.md` current as mounted-doc behavior changes.
2. Next cleanup pass: keep startup and watcher skipped-file logging documented; add UI history docs only if that feature is built.
3. Optional improvements: archive these analysis docs after the cleanup work they describe is complete.

## What Not To Do

- Do not create another reports directory for temporary analysis.
- Do not duplicate storage-path rules in every operations doc.
- Do not keep historical plans in active docs without a strong warning.
- Do not write exhaustive docs for features that are not implemented.
