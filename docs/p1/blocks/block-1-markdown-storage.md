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
