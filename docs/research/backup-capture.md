# #94 — What must a consistent in-app workspace backup capture, and how?

Research date: 2026-10-24. Inspected commit: `0a1f65a` (origin/main). Map:
[#93](https://github.com/LordHalyana/Backlogger/issues/93). Ticket:
[#94](https://github.com/LordHalyana/Backlogger/issues/94). Follow-up decision:
[#95](https://github.com/LordHalyana/Backlogger/issues/95).

Throwaway research branch `research/backup-capture`, never merged. **No product
choice is made here.** Findings, measurements and options with trade-offs only.

Prior evidence used: the #5 research note
([`backup-recovery.md` at 0df84a6](https://github.com/LordHalyana/Backlogger/blob/0df84a69de6a741cb42e88f40363af0f325b6be1/docs/research/backup-recovery.md)),
the shared write coordinator decision
([#54 comment](https://github.com/LordHalyana/Backlogger/issues/54#issuecomment-6285909227)),
`docs/operations/backup-restore.md`, `CONTEXT.md` and
`docs/design/product-direction.md`. There is no `docs/adr/` directory on main.

All `file:line` citations are against `0a1f65a`.

---

## 1. Inventory under `BACKLOGGER_DATA_DIR`

The data dir is `path.resolve(BACKLOGGER_DATA_DIR ?? './data')`; the DB is
`<dataDir>/backlogger.sqlite` (`packages/api/src/server.ts:25-26`). Built-in
templates live in the app image, not the data dir (`server.ts:40`,
`packages/api/src/templates/registry.ts:94-96`).

### Files

| Item | Path | Class | Evidence / notes |
|---|---|---|---|
| Native project trees | `projects/<id>/**` | **Authoritative** | Markdown is the source of truth. Includes `archived/` placement, non-Markdown files (the walker only indexes `.md`, so nothing rebuilds other files), and empty project subfolders created by `ensureProjectSkeleton` (`fs/repository.ts:90-99`). |
| Comments | `projects/<id>/tickets/<task-id>/comments/<comment-id>.md` | **Authoritative** | New since #5 (migration `0012_comments.sql`). Segments in `packages/shared/src/paths.ts:73-75`; walked separately from documents (`fs/repository.ts:505-515`). Comment files carry `schema_version: 1` (`fs/comment-file.ts:42-53`, `shared/src/comments.ts:8`). |
| Sidecar metadata | `projects/<id>/.backlogger/index.json` | **Authoritative** | Holds IDs/type/status/tags for sidecar-mode documents (`fs/sidecar-store.ts:16-34`). A missing or corrupt sidecar silently loads as empty (`sidecar-store.ts:37-51`), so loss is not detected by startup. |
| Inbox designation | `workspace.json` | **Authoritative** | New since #5. `{ "inbox_project_id": ... }` — "the only record of which project is the Inbox" (`services/inbox-service.ts:12-15`). Without it the next start creates a new empty Inbox (`inbox-service.ts:74-92`). Written only at startup, under the exclusive gate (`startup.ts:16-25`). |
| User templates | `templates/*.md` | **Authoritative** | Overrides built-ins by id (`registry.ts:99-101`). The app never writes here: the only template routes are GET (`routes/templates.ts:8,12`) and reload (`routes/admin.ts:25-37`). Edited externally by the user. |
| Project folder symlinks | `projects/<id>` → elsewhere | **Authoritative link, external content** | Root-level project symlinks are followed (`fs/path-resolver.ts:206-233`, `startup.ts:125-135`); `linked` = folder is a symlink (`fs/repository.ts:290-303`, `shared/src/projects.ts:41-45`). Nested symlinks are skipped (`fs/repository.ts:561`). |
| Write leftovers | `<file>.tmp.<pid>.<12 hex>` beside a target | Debris | What a killed durable write leaves (`fs/durable.ts:41-68`). Same naming in sidecar and workspace writes (`sidecar-store.ts:58`, `inbox-service.ts:134`). |
| SQLite main + WAL | `backlogger.sqlite`, `-wal`, `-shm` | Mixed (below) | Opened with `journal_mode = WAL`, `synchronous = FULL`, `foreign_keys = ON` (`db/database.ts:26-31`). Committed rows may still be in `-wal`; copying the main file alone is not a snapshot. |

### SQLite tables (migrations `0001`–`0014`)

| Table | Class | Evidence |
|---|---|---|
| `projects` (id, name, description, read_only, metadata_mode, created_at, updated_at) | **Authoritative** | `0001_init.sql:8-14`, `0007`, `0008`. Auto-discovery recreates only an id-derived name, `read_only = 1`, fresh timestamps, default `frontmatter` mode (`startup.ts:137-145`); the Inbox comes back writable named "Inbox" (`inbox-service.ts:102-115`). |
| `operations` | **Authoritative** (operational) | Pending / completed (retry receipt, `outcome` JSON, no bodies) / abandoned (`0011_operations.sql:106-115`); `dismissed_at` added in `0014_operation_dismissal.sql:226-227`. |
| `operation_payloads` | **Authoritative** (operational) | "Exact intended bytes of a pending operation; removed on completion" (`0011:117-121`). Can hold comment bodies of pending operations. |
| `operation_manifest_entries` | **Authoritative** (operational) | Paths + expected fingerprints for transfers and deletions (`0011:123-131`). |
| `operation_guards` | **Authoritative** (operational) | What a pending operation blocks; path keys are relative to `<dataDir>/projects/` (`0011:133-147`), so they survive a move to a different data dir. |
| `schema_version` | **Authoritative** (structural) | Highest applied migration (`db/database.ts:46-69`); currently 14. |
| `documents` (incl. `read_only`, `revision`, `task_state`, `body_indexed`) | Rebuildable | `0002`, `0003`, `0006`, `0009`, `0010`. `read_only` is derived per document at index time (`services/reindex-service.ts:452-484`). |
| `links`, `tags`, `document_tags` | Rebuildable | `0004`, `0005`. |
| `comments` | Rebuildable | "Rebuilt from Markdown by Reload and Reindex" (`0012_comments.sql:148-164`). |
| `search_fts` (+ triggers) | Rebuildable | `0013_search_records.sql:165-222`. |

**Useful property:** `documents.revision` and `comments.revision` are SHA-256
prefixes of the exact file bytes (`fs/revision.ts:10-21`, sidecar variant
`:28-32`). A DB snapshot therefore already carries a content fingerprint for
every indexed file, which a backup can use to check that file copy and DB
snapshot agree (see option C in §2).

**Measured size split** (generated workspace, §2): the 21 MB DB is ~4× the
4.9 MB of Markdown. The biggest objects are all derived: `search_fts_content`
5.0 MB, `documents` 4.1 MB, `links` 2.3 MB (+2.0 MB autoindex), `comments` 2.2 MB.
300 operation rows were negligible.

### Also authoritative but outside the data dir

- **External mounts** (Docker bind mounts under `/app/data/projects/<id>`,
  `docker-compose.yml:9-20`) and symlink targets. Out of scope for copying (#93).
  But note: Backlogger-authored content can live there. Comments are allowed on
  any writable project (`services/comment-service.ts:439-447`), and a mounted
  project can be switched writable, so tasks, comments and sidecars created
  through Backlogger in such a project live in the external tree, not in the
  data dir.
- **App revision**: `APP_VERSION = '0.3.0'` is hard-coded
  (`packages/api/src/context.ts:33`) and reported by `/health`
  (`context.ts:164`). No git commit is baked into the image (`Dockerfile` has no
  build arg or label for it). DB schema version and comment schema version are
  separate version axes.
- **Deployment config** (host paths of mounts, env) lives in `docker-compose.yml`
  on the host, invisible to the app.

### Changes since #5 (`b714742` → `0a1f65a`)

`workspace.json` (Inbox), comments tree and index, the four operational tables
and `dismissed_at`, document `revision` and `task_state`, `search_fts`
replacing `documents_fts`, `synchronous = FULL`, and the write coordinator with
its workspace gate. The `backup-inventory.test.ts` test (#75) already proves a
stopped full copy replays completed acks and keeps the project row, while a
Markdown-only rebuild loses receipts (`packages/api/src/backup-inventory.test.ts:92-150`).

---

## 2. Consistent snapshot while running

### What the gate actually covers

- `WorkspaceGate` is an in-process FIFO reader/writer lock
  (`services/workspace-gate.ts:10-55`). `coordinator.command()` takes it shared
  (`services/write-coordinator.ts:253-284`); `coordinator.exclusive()` takes it
  exclusive (`write-coordinator.ts:286-292`), used today by full Reindex
  (`reindex-service.ts:113`) and the startup pass (`startup.ts:16-17`).
- Every file-writing path goes through `command()`: documents create/update/
  delete/move/file/capture (`document-service.ts:201,326,548,732`, and update/move via `documentCommand` at `:840-844`),
  comments (`comment-service.ts:123,203,254`), projects (`project-service.ts:73,111,148`),
  folders (`routes/project-folders.ts:26`), recovery actions
  (`recovery-service.ts:109,137`), watcher-triggered Reload (`reindex-service.ts:212`).
  Import funnels into document create.
- **Not gated:** reads (no coordinator call in GET paths); `dismiss`, a single
  synchronous `UPDATE` (`recovery-service.ts:93-103`,
  `write-coordinator.ts:330-332`); template reload (in-memory only); and every
  **out-of-app writer** — editors, `git pull` in a mounted repo, the user
  dropping files into `templates/`. The gate cannot pause those.
- **While the exclusive gate is held, no command is mid-flight.** A command
  holds the shared gate from lookup to completion transaction
  (`write-coordinator.ts:264-271`). So any `pending` row seen under the
  exclusive gate is a stuck operation awaiting recovery review, never an
  in-progress write (see §5).
- **The app never modifies a file in place.** All writes are temp file + fsync
  + rename (`durable.ts:71-82`, `replaceDurable`), temp + hard link for no-overwrite create
  (`durable.ts:84-100`, `createNoOverwrite`), and the same pattern for sidecars and
  `workspace.json`. This makes hard-link snapshots valid against app writes.

### SQLite driver and what it exposes

`better-sqlite3` `^12.4.1` (`packages/api/package.json`), resolved 12.10.0 in
`package-lock.json`. All calls are synchronous on the one connection, except:

- **`VACUUM INTO 'file'`** via `db.exec`. SQLite documents it as producing "a
  consistent snapshot of the original database" and notes it does **not fsync**
  the output ([sqlite.org/lang_vacuum.html#vacuuminto](https://www.sqlite.org/lang_vacuum.html#vacuuminto)).
  Synchronous in better-sqlite3, so it blocks the event loop (reads too) for its
  duration. Output is compacted and written in rollback (`delete`) journal mode;
  verified locally (header bytes 18–19 = 1). `openDatabase` re-enables WAL on
  open (`database.ts:27`), so that is harmless on restore.
- **`db.backup(file)`**: the SQLite online backup API
  ([sqlite.org/backup.html](https://www.sqlite.org/backup.html)), wrapped as a
  promise that copies 100 pages per `setImmediate` step
  (`node_modules/better-sqlite3/lib/methods/backup.js:36-66`). The driver docs say
  changes made through the same connection during the backup are reflected in
  it, and changes from another connection restart it
  ([better-sqlite3 API: `.backup()`](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#backupdestination-options)).
  Backlogger has one connection, so it never restarts; but the snapshot point is
  the **end** of the backup, not its start. Output keeps the WAL flag.
- **`db.serialize()`**: returns the DB as a Buffer (`lib/methods/serialize.js`),
  in memory; a third option for small databases.
- Bundled SQLite reports `sqlite_version()` 3.53.1.

### Can file copy and DB snapshot share one gate window?

Yes. Inside `coordinator.exclusive(...)`, nothing the app does can change files
or authoritative rows (the only ungated DB write, `dismiss`, is synchronous, so
it lands wholly before or after a synchronous `VACUUM INTO`). Taking the DB
snapshot and the file snapshot in the same window yields a pair that matches
what a crash at that instant would leave — which is exactly the state startup
recovery is designed to handle. External writers are the one hole; the gate
cannot close it.

### Measured pause (lean, one machine)

Generated workspace through the real services: 3 projects + Inbox, 3,000
backlog items (~1 KB body, 12 wiki links each, tags), 6,300 comments (300 via
the coordinator, giving 300 receipts), full reindex. Result: 9,300 files,
4.9 MB Markdown; DB 21 MB after checkpoint. Local ext4 on NVMe, i7-10700K, warm
page cache, Node 24. Script: `bench-backup.mts` (scratchpad, not committed).
Two runs each, ms:

| Step under the exclusive gate | Run 1 | Run 2 |
|---|---|---|
| `VACUUM INTO` (→ 20 MB) | 57 | 45–57 |
| `db.backup()` (→ 21 MB) | 34–102 | 30 |
| Node `fs.cp` of `projects/` + `templates/` + `workspace.json` (`preserveTimestamps`) | 2,577 / 2,613 | 2,454 / 2,354 |
| `tar -cf` of the same (GNU tar, uncompressed, 22 MB) | 86–87 | 87 |
| `cp -a` of `projects/` | 392–409 | 395–410 |
| `cp -al` hard-link snapshot of a comparable 9,000-file tree | 245 | — |
| SHA-256 over 9,000 files (manifest checksums) | 686 | — |
| Max event-loop lag during the window | 41–66 | |
| A comment POST queued behind `VACUUM INTO` + `fs.cp` waited | 2,437–2,600 | |
| (Not in a gate) full reindex of this workspace | 14,103–14,791 | |

Readings: the DB snapshot is cheap (tens of ms). The file side dominates and
depends heavily on how it is copied: Node's `fs.cp` is ~25× slower than
`tar`/`cp`. With a streaming tar-like writer, a pause well under a second is
plausible for this size; with `fs.cp` it is ~2.5 s. Cold cache, spinning disk,
Docker Desktop file sharing or a larger workspace would all be slower and are
unmeasured. gzip of the 22 MB tar is 0.7 MB (Markdown and FTS compress well).
Reads stay available throughout, except during synchronous steps that block the
event loop (`VACUUM INTO`, synchronous hashing).

### Snapshot options

| | How | Write pause | Consistency | Costs / risks |
|---|---|---|---|---|
| **A. Stop-the-world (today's doc)** | Stop app, copy data dir | Whole app down | Exact | Not in-app; misses external mounts; the user must remember. |
| **B. One exclusive window, full copy inside** | `exclusive{ VACUUM INTO; copy/stream all files }` | Snapshot + whole copy (≈0.1–2.6 s here) | Exact vs app writes | Pause grows with workspace and copy speed; copy errors happen while writes queue; out-of-app writers still race. |
| **C. Exclusive window for DB + hard-link file snapshot, archive outside** | `exclusive{ VACUUM INTO; cp -al projects/ templates/ workspace.json → staging }`, then archive/hash/compress with writes resumed | DB snapshot + link pass (≈0.3 s here) | Exact vs app writes, because the app never writes in place (`durable.ts`) | Staging must be on the same filesystem (hard links); not possible across Docker bind mounts (which are excluded anyway). External editors that write in place would mutate the "snapshot". Needs cleanup of staging. Not available on some filesystems. |
| **D. Optimistic, no exclusive gate, verified** | Copy files, then `VACUUM INTO`, then compare each copied file's SHA-256 with `documents.revision` / `comments.revision` in the snapshot; retry or fall back to B on mismatch | None in the common case | Detects torn pairs for indexed files only | Non-indexed files (attachments, templates, sidecars, `workspace.json`, unparseable files) are not covered; more code; retry loop under write load. |
| **E. DB-only online snapshot + per-file copy without coordination** | `db.backup()` while serving, copy files whenever | None | **Not consistent** | Pending operations, receipts and files can disagree; restore behaves like a crash at an undefined, possibly impossible, instant. Listed for completeness. |

Orthogonal choice for any of A–D: **whole DB vs authoritative tables only.**
Including the full DB snapshot (index included) makes restore immediate and
exact. Exporting only `projects`, `operations*` and `schema_version` shrinks the
DB part a lot (derived tables dominate size) but forces a full reindex at first
start (~14 s here, under the exclusive startup gate; `startup.ts:55-66`
auto-reindexes when `documents` is empty).

---

## 3. External mounted projects and sidecars

### What the app can see today

- **Symlinked project folders**: `lstat` says symlink; `readlink` gives the
  target (`fs/repository.ts:290-303`). Copying the link verbatim (not its
  target) records the mount without copying content.
- **Docker bind mounts**: inside the container they look like plain directories.
  `lstat` cannot tell them apart from native folders, and `st_dev` comparison is
  unreliable: a bind mount from the same host filesystem as the named volume
  (the compose setup in `docker-compose.yml:7-20` puts both on the host root
  disk) has the same device ID. The reliable signal is a separate entry in
  `/proc/self/mountinfo` whose mount point is `<dataDir>/projects/<id>`
  ([proc(5), mountinfo](https://man7.org/linux/man-pages/man5/proc_pid_mountinfo.5.html)).
  Its "root" field is the path within the source filesystem, which is often but
  not always the host path; the true host path is only in the compose file.
- Consequence: a naive recursive copy or tar of `projects/` **follows into bind
  mounts and copies external content**, contradicting the #93 ruling. `tar
  --one-file-system` does not help for the same-device case. Exclusion has to be
  driven by mountinfo (or by an explicit list).

### What restore needs to rebuild rows and report missing mounts

Per project, from the `projects` row plus a filesystem probe:

| Field | Source | Why |
|---|---|---|
| `id`, `name`, `description`, `created_at`, `updated_at` | `projects` row | Discovery recreates only defaults (`startup.ts:137-145`). |
| `read_only`, `metadata_mode` | `projects` row | Lost write policy is the silent #5 gap; sidecar is consumed regardless of mode. |
| Kind: `native` / `symlink` / `mount` | `lstat` + mountinfo | Decides copy vs record. |
| Link target or mount source (best known) | `readlink`; mountinfo root | So restore can say "expected `/opt/dev-local/x/docs` at `projects/x`". |
| Filesystem writability at backup time | `access(W_OK)` / mount `ro` flag | Distinguishes "project row writable but mount read-only". |
| Presence + sidecar present + counts (docs, comments) + optional digest | walk at backup time | Lets restore report "mount missing" or "mount present but different" (e.g. doc count or digest differs). |
| Inbox flag | `workspace.json` | Already copied as a file. |

Restore behaviour with a missing mount, as the code stands: the row is kept;
startup sync walks a missing folder as empty (`fs/repository.ts:548-558`) and
removes that project's index rows (`reindex-service.ts:297-300`); they come back
when the mount reappears and the project is synced. Nothing authoritative is
lost, but the user sees an empty project with no explanation. A pending
operation guarding paths in a missing mount stays in recovery
(`write-coordinator.ts:363-376`).

### The sidecar and external-content question

Under "record, don't copy", **sidecar files of mounted projects and any
Backlogger-authored tasks/comments inside them are not in the backup**. For a
sidecar-mode mounted project, document IDs, tags and status live only in
`<mount>/.backlogger/index.json`; losing it re-derives path-hashed IDs
(`reindex-service.ts:517-562`) and breaks identity. Options:

- **S1. Record only** (pure #93 ruling): rely on the external repo's own backup;
  report sidecar presence/digest so restore can warn.
- **S2. Copy Backlogger-owned files from mounts**: `.backlogger/` and
  `tickets/*/comments/` (small, written only by Backlogger), but not the user's
  own Markdown. Narrows the identity gap; blurs the "not copied" line and can
  diverge from the external repo's history on restore (which copy wins?).
- **S3. Copy external content only on explicit opt-in per project.**

---

## 4. Archive formats, manifest, export vs full backup

### Format candidates

| Format | Pros | Cons |
|---|---|---|
| **Plain directory** (timestamped folder) | No dependency; restore is copy; diffable; rsync/borg-friendly; `cp -al`/reflink can make it nearly free | Not one file to download/move; integrity of a half-written folder must be marked (manifest written last); through HTTP needs another format anyway. |
| **tar** (pax, optionally gzip/zstd) | Streamable (HTTP download without a temp file); keeps symlinks verbatim, modes, sub-second mtimes (pax headers); native on Linux/macOS, Windows 10+ ships `tar` | Node has no built-in tar writer: needs a dependency (e.g. `tar`) or a small hand-written pax writer; no random access. |
| **zip** | Double-click on Windows/macOS; random access (read manifest first) | Needs a dependency (Node's zlib has no zip container); DOS timestamps are local time with 2 s resolution unless an extended-timestamp extra field is written; symlink support is non-standard. |
| **SQLite archive (`sqlar`)** | Same driver, no new dependency; one file; can hold the DB snapshot's tables and the files together | Opaque to users without `sqlite3 -A`; unusual. |

mtime fidelity matters: plain (unadopted) Markdown takes `created_at` from
birthtime and `updated_at` from mtime (`fs/repository.ts:577-578`). Birthtime
cannot be restored on Linux at all, so those values change on any restore;
mtime can be preserved if the format and the restore keep it.

### Manifest contents (candidates)

- Backup format version; created-at; kind (`full` / `export`).
- App identity: `APP_VERSION` (`context.ts:33`), DB `schema_version` (14), comment
  `schema_version` (1); git commit if the build starts recording one (it does not
  today); the workspace ID once the sibling ticket adds one.
- Inbox id (mirrors `workspace.json`).
- Per project: the §3 table (row fields, kind, target/source, writability,
  presence, counts, digests).
- Per file: relative path, size, mtime, SHA-256 (686 ms per 9,000 files here;
  can run outside the gate under option C).
- Operational summary: counts of completed / pending / abandoned operations; ids
  of pending ones and the projects they guard.
- Snapshot method and gate duration (diagnostics).

### Portable content export vs full backup

The whitepaper names both: "A portable content export, plus a full backup that
also captures non-rebuildable settings and operational data via a consistent
snapshot or paused writes" (`docs/design/product-direction.md:133-137`), and
"only the content index is assumed rebuildable" (`:107-112`); first-release
row "workspace export, documented backup and restore" (`:72`); release check
"Export and restore preserve stable IDs, links, comments and attachments"
(`:203`). Today only per-document raw export exists, and import mints new IDs
(#5 R12; `product-direction.md:245-247`).

| | Portable content export | Full backup |
|---|---|---|
| Purpose | Move content to another workspace or tool; human-readable | Equivalent restore of *this* workspace |
| Contains | Markdown, comments, sidecars, templates, project settings as JSON/YAML | Everything authoritative: files + DB snapshot (receipts, pending ops, payloads, guards, project rows) |
| Restore target | New or existing workspace; IDs kept but merged; conflicts possible | Empty install only (replace) |
| Retry receipts | Meaningless across workspaces; excluded | Kept: completed retries replay (`backup-inventory.test.ts:92-123`) |
| Pending operations | Excluded (or refused) | Kept as-is (§5) |
| Needs an importer that keeps IDs | Yes (the current import does not) | No (files + DB restore directly) |

The two can share one archive layout (export = full minus `backlogger.sqlite`,
plus a settings file), or be separate features.

---

## 5. Pending operations and recovery state in a snapshot

Facts: under the exclusive gate nothing is in flight (§2), so `pending` rows are
operations whose command failed after intent or that startup recovery could not
finish. Their guards block specific tasks/paths (`RECOVERY_REQUIRED`). On any
start, `recoverPending` tries to resume every pending operation before discovery
(`startup.ts:27-29`, `write-coordinator.ts:363-376`). Payloads may hold content
bytes not yet in any file (`0011:117-121`). Abandoned operations keep their row
(no payload) until dismissed (`0014`).

| Option | Behaviour | Restore consequence | Trade-offs |
|---|---|---|---|
| **P1. Include as-is** | Snapshot files + all operational tables in one gate window | Restore = crash at that instant: startup tries recovery again; same outcome as restarting the live app. Abandoned/undismissed notices return. | Simple; faithful; recovery state follows the data. Pending ops on mounts may fail differently if the mount differs. Payload bytes travel in the backup. |
| **P2. Refuse while any are pending** | Backup fails with a list (`GET /api/recovery`) | No pending state ever restored | A single stuck operation (perhaps on a mount the user cannot fix) blocks all backups — the moment a backup matters most. |
| **P3. Try to drain first** | Under the gate, run `resume` for each pending op, then snapshot | Fewer pending ops in backups | Recovery runs on the backup path; may change files; still needs P1 or P2 for what will not drain; lengthens the pause. |
| **P4. Include, but warn and record** | P1 plus manifest listing pending ids and a visible warning | As P1, with an explanation at restore | Small extra over P1. |
| **P5. Exclude operational state** (export-style) | Drop `operations*` | Like a Markdown-only rebuild: receipts gone, pending work silently lost, guards lifted | Defeats the purpose of a full backup; reasonable only for the portable export. |

Also relevant: completed receipts grow without bound (no pruning seen in
`db/operations-repo.ts`); they are small (`outcome` metadata only), but a backup
carries all of them.

---

## Open questions for #95 ("What should workspace backup and restore do for the user?")

1. Which snapshot method (A–D) and what write pause is acceptable? Is a hard
   number needed, or "measure in the CI test"?
2. Full DB snapshot vs authoritative tables only (size vs ~14 s reindex at first
   start for 3k tasks)?
3. Pending operations: P1/P4 include, P2 refuse, P3 drain? And does a restore
   show pending/abandoned operations to the user up front?
4. External mounts: record-only (S1), or also copy Backlogger-owned files inside
   them (S2: sidecars, comments)? How is a bind mount detected and excluded
   (mountinfo) — and what if detection fails?
5. Restore with a missing or different mount: refuse, restore and warn, or
   restore and hold the project read-only until the mount appears?
6. Out-of-app writers (editors, `git pull`, template drops): accept the race,
   warn, or verify with checksums (option D)?
7. Archive form: directory, tar(.gz/.zst), zip, other? Download over HTTP vs
   written to a path (inside the data dir it would be captured by the next
   backup unless excluded)?
8. Is the portable content export part of this release, or only the full
   backup? If both, one layout or two?
9. Manifest: which app identity to record (APP_VERSION, DB schema, git commit —
   which would need a build change), and does restore refuse a newer-schema
   backup on an older app?
10. Restore target: empty install only, or replace a live workspace (which needs
    stopping the app or swapping the DB connection under the gate)?
11. Leftover `*.tmp.*` files and unparseable files: include verbatim or skip?
12. Should the snapshot hash every file (integrity check on restore) given the
    measured ~0.7 s per 9k files?

## Evidence limits

Source inspection plus one lean benchmark on a fast local disk with warm cache;
no Docker, no cold-cache, no Docker Desktop or network filesystem runs; the
mountinfo-based bind-mount detection was reasoned from the man page, not tried
in a container. No production code changed.
