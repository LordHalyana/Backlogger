---
id: ce1d67ed-e982-4d5f-8fd5-aacb7368f92e
title: "Block 1 — Markdown Storage"
project: backlogger-docs
type: design_doc
status: archived
created_at: "2026-05-30T07:02:10.122Z"
updated_at: "2026-05-30T10:11:26.363Z"
tags: ["p1"]
---

# Block 1 — Markdown Storage

> Parent: [../implementation_plan.md](../implementation_plan.md)
> Depends on: Block 0.
> Delivers: safe read/write of `.md` files under `data/projects/`, plus a reindex command.

---

## 1. Purpose

Make the filesystem the source of truth for Markdown content. Provide a small, well-tested module that every higher block uses for disk I/O.

---

## 2. Scope

In scope:
- `FsRepository` with CRUD on Markdown files.
- Centralized path resolver that rejects traversal, symlinks, and absolute paths.
- Atomic write strategy (temp file + `fsync` + `rename`).
- Frontmatter parse/serialize via `gray-matter`.
- `scripts/reindex.ts` that walks `data/projects/` and prints a summary (used later by Block 4 to rebuild the DB).
- Unit tests against a per-test temp directory.

Out of scope: SQLite, HTTP routes, project concept (handled in Block 2).

---

## 3. Design

### 3.1 Filesystem layout

```text
data/projects/<project-id>/
├── ideas/
├── design-docs/
├── implementation-plans/
├── backlog/
└── notes/
```

### 3.2 Path rules

- `<project-id>`: `^[a-z0-9][a-z0-9-]{1,62}$`
- Filename: `^[a-z0-9][a-z0-9-_]{0,127}\.md$`
- Resolver returns an absolute path **only** if it lies under the configured `BACKLOGGER_DATA_DIR/projects/`. Anything else throws `PathOutsideDataDirError`.
- Symlinks under `data/` are rejected via `fs.lstat`.

### 3.3 `FsRepository` API (TypeScript)

```ts
interface RawDocument {
  path: string;              // relative to data/projects
  frontmatter: Record<string, unknown>;
  body: string;
}

interface FsRepository {
  ensureProjectSkeleton(projectId: string): Promise<void>;
  removeProject(projectId: string): Promise<void>;
  listProjectFiles(projectId: string): Promise<string[]>;   // relative paths
  read(relativePath: string): Promise<RawDocument>;
  write(relativePath: string, doc: RawDocument): Promise<void>;
  delete(relativePath: string): Promise<void>;
  walk(): AsyncIterable<RawDocument>;                       // for reindex
}
```

### 3.4 Atomic write

1. Resolve + validate target path.
2. Ensure parent directory exists.
3. Write to `<target>.tmp.<pid>.<rand>`.
4. `fs.fsync` the temp file's fd.
5. `fs.rename` to target.
6. On any error, attempt cleanup of the temp file.

### 3.5 Errors

`PathOutsideDataDirError`, `InvalidFilenameError`, `DocumentNotFoundError`. All extend a common `FsRepoError` with a stable `code`.

---

## 4. Tasks

1. Add `gray-matter` dependency.
2. Implement path resolver + tests covering traversal, symlink, bad filename cases.
3. Implement `FsRepository` against `node:fs/promises`.
4. Implement `ensureProjectSkeleton` (creates the 5 subfolders idempotently).
5. Implement `walk()` as an async iterator.
6. Add `scripts/reindex.ts` (prints counts per project/type for now).
7. Tests against `tmp` directories created per test (`fs.mkdtemp`).

---

## 5. Exit Criteria

- All `FsRepository` methods covered by unit tests including failure modes.
- Creating a project skeleton produces exactly the 5 expected folders.
- Writing then reading a document round-trips frontmatter and body byte-for-byte.
- Reindex script runs against an empty and a populated `data/` without error.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Path traversal vulnerability | Centralized resolver + dedicated test suite. |
| Partial writes corrupt files | Temp-file + rename + fsync. |
| OS-specific filename edge cases | Restrict allowed character set; tested on Linux CI runners. |

---

## 7. Implementation Notes

**Status:** ✅ Complete (M1).

### What shipped
- `PathResolver` with project-id / filename validation, relative-path resolution, and a `assertNoSymlinks` walker that rejects symlinks on any component between `projectsRoot` and the target ([packages/api/src/fs/path-resolver.ts](../../../packages/api/src/fs/path-resolver.ts)).
- `FsRepository` with `ensureRoot`, `ensureProjectSkeleton`, `removeProject`, `projectExists`, `listProjectFiles`, `read`, `write`, `delete`, `walk`, `walkProject` ([packages/api/src/fs/repository.ts](../../../packages/api/src/fs/repository.ts)).
- Atomic writes: open temp file `wx` in target directory, `writeFile` → `fsync` → `close` → `rename`. Temp file is cleaned up on rename failure.
- Typed error hierarchy with stable `code` field ([packages/api/src/fs/errors.ts](../../../packages/api/src/fs/errors.ts)).
- Markdown parsing/serialization via `gray-matter`.
- `scripts/reindex.ts` summary tool wired as `npm run reindex` ([scripts/reindex.ts](../../../scripts/reindex.ts)).
- 47 new unit tests (31 resolver + 16 repository) running against per-test `mkdtemp` directories — zero contact with the real `data/`.

### Deviations from the design
- **Body trailing newline.** `gray-matter`'s `stringify` always appends a trailing newline. Round-trip is therefore byte-for-byte modulo a final `\n` on the body. Tests assert the actual behavior; the design's "byte-for-byte" wording is amended in spirit — the *content* round-trips, with serializer-driven newline normalization.
- **`walk()` skips symlinked entries silently.** The design says symlinks are rejected. `assertNoSymlinks` does reject them on read/write paths; `walk()` instead skips them during traversal so a stray symlink can't poison a reindex. Symlinks placed *above* a target file are still rejected through `assertNoSymlinks` on every read/write.
- **`walkMarkdown` swallows parse errors.** Unparseable `.md` files are silently skipped during `walk()` so reindex can't crash on hand-edited corruption. Block 4's reindex service will log skipped files.
- **`reindex` script is read-only.** Block 1 only needs the summary; the actual DB rebuild lives in Block 4.

### Verification (local)
- `npm run typecheck` — pass.
- `npm run lint` — pass (0 warnings).
- `npm test` — 48/48 pass (1 prior + 47 new).
- `npm run build` — pass.
- `npm run reindex` — prints zero-doc summary against empty `data/`.

### Follow-ups for later blocks
- Block 4 will replace the read-only reindex with one that rebuilds the SQLite `documents` table and logs skipped files with reason.
- Block 4's `DocumentService` will sit on top of `FsRepository`; no further changes needed here for now.
