# Research: one in-process commit seam for comment, transfer, deletion and recovery writes

Issue: [#54](https://github.com/LordHalyana/Backlogger/issues/54), part of map [#44](https://github.com/LordHalyana/Backlogger/issues/44)
Inspected revision: `origin/main` at `259168e` (merge of PR #53). Code under `packages/api/src` is unchanged from the daily-work baseline `1335914`, because PR #53 touched only docs.
Research date: 2026-10-20
Status: findings and options for human review. Nothing is decided, implemented or tested. No GitHub issue was changed.

Line references are to `259168e` unless a URL says otherwise. **Fact** sections only report what the sources say. **Recommendation** sections give my proposals, and the note labels them as such.

---

## 1. Question

Several operations write both Markdown files and SQLite operational state: comment create, edit and delete, task filing (transfer), permanent task and project deletion, recovery (recheck, resume and abandon), and reindex. The ticket asks two things:

1. Should `ProjectQueue` become the single commit seam that runs precondition checks, then a durable file write, then one SQLite transaction? Or do the approved #48/#49 decisions need a different seam: task-scoped locks, a workspace lock for receipt lookup, or a combined file+SQLite commit helper? Which lock order and operation order do those decisions rely on?
2. Rule on three items from the *Backlogger System Map*: domain events, a native file-watcher policy, and full backup/restore. Each is either confirmed or rejected as out of scope for map #44.

---

## 2. Current code facts (cited)

### 2.1 What `ProjectQueue` is

- It is a promise chain per project ID, held in a `Map<string, Promise>`. `run(projectId, op)` chains `op` after the current tail and runs it whether the previous op succeeded or failed (`packages/api/src/services/project-queue.ts:11-23`).
- Its header comment says every document mutation and project reindex runs through it, and that it assumes a single server process with no external writers (`project-queue.ts:1-10`; `docs/design/architecture.md:104`).
- It is **not re-entrant**. Calling `run(p)` from inside an op that already holds `p` waits on its own tail forever. No current code does this.
- It provides no shared/exclusive modes, no timeouts and no way to hold "every project" at once.
- `buildContext` creates exactly one instance and shares it between `DocumentService` and `ReindexService` (`packages/api/src/context.ts:69-92`).

### 2.2 Who acquires the queues

| Caller | Queue(s) taken | Source |
|---|---|---|
| `DocumentService.create` | target project | `document-service.ts:150-157` |
| `DocumentService.capture` | target project (Inbox by default) | `document-service.ts:276-298` |
| `update`, `delete`, `move` (via `inDocumentQueue`) | project read from the index **before** queueing | `document-service.ts:300-309, 482-484, 515-517, 719-725` |
| `DocumentService.file` | both projects, sorted by ID, nested `run(first, () => run(second, …))` | `document-service.ts:634-642` |
| `ReindexService.runProject` (project Reload) | that project; an extra `inFlight` set rejects a second concurrent reload | `reindex-service.ts:140-150` |
| `runProject` callers | startup sync and discovery (`startup.ts:32, 136`), file watcher (`fs/project-watcher.ts:34`), Reload route (`routes/project-reload.ts:21`) | — |
| `ImportService` | indirectly, through `DocumentService.update/create` | `import-service.ts:109, 153` |

`inDocumentQueue` re-reads the summary once it holds the queue. It does **not** check that the document still belongs to the project whose queue it holds (`document-service.ts:719-725`). Filing can move a task while an update or delete waits. #48 recorded the same observation ([comment 6261207977](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6261207977), "Evidence and limits"). `fileInQueues` does handle this for itself: if the source changed while it waited, it returns `REVISION_CONFLICT` (`document-service.ts:663-670`).

### 2.3 Paths that write outside any queue

| Path | What it writes | Source |
|---|---|---|
| Full reindex `ReindexService.run()` | Takes **no** project queue. Truncates `documents`, `links`, `tags` as three separate statements, then rebuilds row by row. It can also insert new project rows (`ensureProjectForIndex`). | `reindex-service.ts:93-133, 254-267`; `architecture.md:104` |
| Full reindex callers | Startup when the index is empty, and `POST /api/admin/reindex` | `startup.ts:46-55`; `routes/admin.ts:16-23` |
| `ProjectService.create/update/delete` | Project rows and folders. `delete` removes the row **then** `rm -rf` on the folder and ignores errors | `project-service.ts:43-104`; `fs/repository.ts:73-80` |
| Folder routes | `createFolder` / `removeFolder` | `routes/project-folders.ts:35-65`; `fs/repository.ts:131, 145` |
| `InboxService.ensure` / `writeWorkspaceFile` | `workspace.json` and the Inbox project row. Runs at startup only | `inbox-service.ts:65-92, 132-143`; `startup.ts:18` |
| Startup discovery | Inserts project rows for unknown folders, then runs `runProject` (queued) | `startup.ts:96-141` |
| Sidecar store | `set/rename/delete` do a whole-file read-modify-write. **Every caller is inside a queued `DocumentService` op**, and reindex only reads it | `fs/sidecar-store.ts:79-101`; callers in `document-service.ts:225, 439, 501, 551-556` |

#48 also records that project settings bypass the queue and that the durable guards must cover them ([6276838558](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6276838558), "Evidence").

### 2.4 How SQLite writes are transacted today

- The database opens in WAL mode with foreign keys on. `synchronous` is **not set** (`db/database.ts:26-28`). The `better-sqlite3@12.10.0` build in the main checkout's `node_modules` compiles with `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1` (NORMAL) (`node_modules/better-sqlite3/deps/defines.gypi:16`). So WAL commits are currently **not** `synchronous=FULL`. I did not confirm this against a running server's `PRAGMA synchronous`.
- `better-sqlite3` is synchronous. A `db.transaction(fn)` runs to completion without yielding to the event loop, so no other in-process JS can interleave with it. You also cannot `await` inside one. Async file I/O always falls *between* transactions.
- Each mutation makes several separate commits. `documentsRepo.upsert` is one autocommit statement (`db/documents-repo.ts:133-160`). `linkService.rebuildForDocument` is its own transaction (`link-service.ts:91-113`) and `tagsService.rebuildForDocument` is another (`tags-service.ts:22-30`). **No transaction spans the document row, links and tags of one mutation.** Migrations are the only other explicit transaction (`database.ts:60-64`).
- Ordering today is "file first, then index". `create` writes the file, upserts, and deletes the file on upsert failure (`document-service.ts:221-255`). `update` writes the new path, deletes the old path and ignores errors, then upserts (`:370-392`). Filing writes the target, deletes the source, then upserts (`:689-706`). Document `delete` removes the **DB row first**, then the file, ignoring errors (`:497-505`). Project delete does the same (`project-service.ts:102-103`).
- Graph cache invalidation is a separate in-memory call after the SQLite writes (`document-service.ts:259, 401, 707-708`).

### 2.5 Durability primitives that exist

| Primitive | Where | Present? |
|---|---|---|
| Temp file in the same directory, opened with `wx`, `fsync` on the file handle, then `rename` | `FsRepository.writeAtomic` (`fs/repository.ts:242-261`) and `SidecarStore.save` (`fs/sidecar-store.ts:52-73`) | Yes |
| `workspace.json`: temp written with `flag: 'wx'`, then `rename` | `inbox-service.ts:132-143` | Yes, but **no fsync** of the file |
| Directory `fsync` after rename, unlink or mkdir | anywhere | **No** (no `fsync`/`datasync`/directory handle sync in `packages/api/src`) |
| Exclusive create of the *target* (no-clobber) | anywhere | **No.** `rename` replaces the destination silently. `wx` applies only to the temp name |
| Verified delete (compare fingerprint before unlink) | anywhere | **No.** `delete` is a plain `unlink` (`repository.ts:264-274`), and project removal is `rm -rf` (`:73-80`) |
| SQLite `synchronous=FULL` | — | **No** (see 2.4) |

Prior research reached the same conclusions: there is no directory sync and no power-loss claim (`git show origin/research/write-safety-2026-10-16:docs/research/write-safety.md`, lines 56-58). The #49 temporary-payload decision notes that temp files "are not durable operation-associated recovery payloads" ([6268127335](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6268127335)).

### 2.6 Startup and watcher order

`server.ts` opens the DB and builds the context. It then **starts the project file watcher** (`server.ts:51-55`) **before** `prepareDataDir` (`:60`), and calls `app.listen` only afterwards (`:79`). `prepareDataDir` ensures the Inbox, discovers folders, runs `runProject` for every project, and runs a full reindex when the index is empty (`startup.ts:13-56`). The watcher can therefore enqueue reloads while startup sync is still running. Requests are not served until `prepareDataDir` finishes.

### 2.7 Where the Backlogger System Map is

The map is **not in the repo**. It is a claude.ai artifact linked from [#46 comment 6261061119](https://github.com/LordHalyana/Backlogger/issues/46#issuecomment-6261061119): `https://claude.ai/artifact/DhmmGgPNaxnvd8aaDsHEKm`, "revised 2026-10-19", built from head `e6c89fa`. I read its current published version (`1792363700-1e8c`) with the artifact reader. Its relevant claims:

- Finding "DocumentService is turning into the whole domain". It proposes "a `RecordStore.commit(projectId, mutation)` seam that owns queue → revision → atomic write → index", with links, tags, FTS and graph as projections. It is marked "Decided (Q3): the seam is built before comments, as the first issue of the comments map."
- Finding "The live file watcher contradicts the stated write model". It also says the full `ReindexService.run()` bypasses the queue, and proposes to "Route the full reindex through every project queue, or pause the queues while it runs". Marked "Decided (D5): native projects use explicit reload or import only. The watcher stays only for mounted reference docs."
- Finding "No workspace backup or restore". It proposes `POST /api/admin/export`: "pause the queues, take a SQLite `VACUUM INTO` snapshot, tar…", plus an e2e restore test. Marked "Decided (D8, D9, Q4)".
- Phase A plan: the seam, "an `events` row for every commit", comments, explicit reload only for native projects, and backup/restore with a CI restore test.
- `ProjectQueue` node: "Filing between projects needs both queues. Check the lock order when cross-project operations grow."

#46 records that this Phase A expansion "(events, watcher policy and full backup/restore) is not silently approved" ([6261130649](https://github.com/LordHalyana/Backlogger/issues/46#issuecomment-6261130649)). Map #44 lists "Automatic audit/event log of every task change" and "multi-process write safety and full backup product" as out of scope (#44 body, "Out of scope").

---

## 3. What the approved decisions require of a seam

Each row is a requirement that some seam must meet, cited to the decision that imposes it. "Ordering" means the order of steps inside one operation. "Locking" means what must be mutually exclusive.

| # | Requirement | Kind | Decision |
|---|---|---|---|
| R1 | Comment mutations use the **same coordination** as task operations and **recheck the parent's location after waiting** | locking | [48/6261207977](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6261207977); [49/6261471734](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6261471734) ("Inside the coordinated operation, recheck the parent's location, lifecycle and project writability") |
| R2 | Transfers coordinate **both projects in stable order** and recheck ownership after waiting | locking | [48/6276838558](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6276838558) ("Enforcement") |
| R3 | **Full Reindex is coordinated with writes.** Reload/Reindex consult pending manifests and never apply the legacy duplicate winner to tracked transfers | locking + ordering | [48/6261207977](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6261207977); [48/6273215040](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6273215040) |
| R4 | Operation UUIDs are **workspace-wide**. For an existing ID, compare the fingerprint and read the recorded state **before** checking today's revision or lifecycle | ordering | [49/6271610178](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6271610178) |
| R5 | Validate request and domain preconditions **before persisting a new operation**. Once intent is durable, the ID is permanently bound to its fingerprint | ordering | [49/6271610178](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6271610178) |
| R6 | **Concurrent requests sharing an operation ID cannot both execute.** Unfinished operations enter recovery, not blind re-execution | locking | [49/6265793037](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6265793037) |
| R7 | Missing or invalid Idempotency-Key gives 400 **before any mutation**. Same key and input returns the recorded ack even after later filing or deletion | ordering | [49/6275973008](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6275973008) |
| R8 | **Persist recovery intent before changing Markdown.** Acknowledge only after completion is durably recorded. Operational tables live in the existing SQLite DB and survive reindex | ordering | [49/6267223253](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6267223253) |
| R9 | Comment write sequence: (1) acquire coordination and check op ID, parent and revision → (2) durably persist intent, fingerprints and payload → (3) apply the Markdown change with filesystem syncs → (4) verify, then **one SQLite txn**: index + completion + payload removal → (5) respond | ordering | [49/6268372495](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6268372495); [49/6268127335](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6268127335) |
| R10 | WAL with **`synchronous=FULL`** for operational commits. **Directory syncing** for rename, delete and mkdir must be verified before any power-loss claim | durability | [49/6268372495](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6268372495) |
| R11 | Transfer phases: prepare (inventory, manifest) → copy (never overwrite an unexpected destination) → verify + filesystem durability → **durable `destination_verified` checkpoint** → verified source cleanup → **one SQLite txn** for indexes + completion | ordering, multi-phase | [48/6273215040](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6273215040) |
| R12 | Deletion phases: prepare under shared coordination → persist inventory → mark pending (hidden from boards and search) → remove only verified files → verify + durability → **one SQLite txn**: remove derived records + completion. Directories are removed only when empty. No recursive resume | ordering, multi-phase | [48/6275396250](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6275396250) |
| R13 | Pending operations block conflicting **task-scoped** writes (task, its comment set, reserved paths) beyond the request's lifetime. Project deletion blocks the whole project. Any pending op blocks `metadataMode`/`readOnly` changes. **Check durable pending records inside shared coordination immediately before mutation.** Import and folder operations obey the same rules | locking (durable) | [48/6276838558](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6276838558); [49/6268372495](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6268372495) ("In-memory queue lifetime alone is insufficient") |
| R14 | **Startup establishes protections from pending records before accepting writes** and inspects unfinished transfers before normal indexing. Unresolved conflicts restrict only the affected resources afterwards | ordering | [48/6276838558](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6276838558); [48/6261207977](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6261207977) |
| R15 | Recheck resumes the **original** operation ID. Abandonment uses its own Idempotency-Key and review token, and **its ack, the original op's abandoned state and payload removal commit in one SQLite txn** | ordering | [48/6275518509](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6275518509); [49/6268573260](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6268573260) |
| R16 | Pending deletion takes precedence over indexing. Startup, Reload and Reindex must not reactivate surviving files | ordering | [48/6275396250](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6275396250) |
| R17 | Search caches are invalidated after app saves, filing, deletion and Reload/Reindex. Pending-deletion items and recovery payloads are excluded from search | post-commit | [50/6276990879](https://github.com/LordHalyana/Backlogger/issues/50#issuecomment-6276990879) |
| R18 | Stale revisions use `REVISION_CONFLICT` with structured details (document edits, filing, comments). Comment edit/delete require `If-Match` (428 when missing) | precondition | [#52](https://github.com/LordHalyana/Backlogger/issues/52); [49/6261471734](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6261471734) |
| R19 | Single process only. No multi-process or external-writer guarantee | scope | [48/6276838558](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6276838558); [49/6268372495](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6268372495); #44 "Out of scope" |

**Consequence for the ticket's framing (fact derived from R8, R9, R11, R12, R15).** The approved protocols do **not** have the shape "preconditions → durable file write → one SQLite transaction". Each has **at least two** SQLite commits:

- an **intent** commit before any file change (R8, R9 step 2);
- a **completion** commit after the file change is verified (R9 step 4).

Transfers add a third, durable checkpoint commit (R11). Deletion's "mark pending" belongs to the intent commit or immediately follows it (R12). Whatever seam is chosen must model *intent txn → durable file effects → (checkpoint txn → more effects)* → completion txn*. A single trailing transaction is not enough.

**Second consequence.** The "task-scoped locks" in the decisions (R13) are **durable pending-operation guards** stored in SQLite, not in-memory mutexes. R13 says to check them *inside shared coordination*. That presupposes an in-process coordination layer, but it does not require that layer to be task-granular.

---

## 4. Options

Every option assumes these points:

- A `UNIQUE` operation-ID column in the operational table.
- Synchronous better-sqlite3 transactions.
- The durable guards from R13.

The options differ in **who owns the ordering and the locks**.

### Option A: extend `ProjectQueue` as the sole seam

`ProjectQueue` gains `runMany(projectIds, op)`, which acquires sorted IDs. Full reindex acquires every known project's queue in sorted order. Each service (`DocumentService`, a new `CommentService`, deletion and recovery services) implements its own intent, effects and completion steps inside the queue.

- **Pros.** Smallest change. The per-project granularity that write-safety research recommended for a single-user app stays (`write-safety.md` lines 72-74). Filing already works this way (`document-service.ts:634-642`).
- **Cons.**
  - The queue only orders work. Receipt lookup, guard checks, intent/completion transactions, durable file primitives and cache invalidation get re-implemented in each service. That is the duplication the System Map flags ("Every operation repeats queue → load → revision → write → upsert → fan-out").
  - Non-queued writers (project settings, folders, project deletion) each need wiring by hand. R13 says they must obey the guards.
- **Failure cases.**
  - *Filing across two projects:* deadlock-free with sorted acquisition. But each service must remember to recheck the parent's project after waiting (R1). Today `inDocumentQueue` does not (§2.2). One forgotten recheck lets a comment write land in a project whose queue is not held.
  - *Workspace reindex vs pending operations:* "acquire all project queues" snapshots the project list. A project created (`project-service.ts:43`) or discovered (`reindex-service.ts:254-267`) during the run is not covered. Holding N queues also means N nested promise layers. It works but is fragile.
  - *Receipt lookup race on retry:* same ID and same target serialize in one queue, so the second sees the receipt. Same ID with different input in **different** projects passes lookup in both queues. Only the `UNIQUE` constraint at intent insert separates them. That is correct only if every service maps the constraint error to a re-lookup.
  - *Startup recovery before serving:* nothing structural enforces it, only call order in `startup.ts`/`server.ts`. The watcher already starts before startup sync (§2.6).

### Option B: task-scoped in-process locks under (or instead of) the project queue

Add a mutex keyed by task UUID, and possibly by comment UUID. Comment ops take the task lock. Filing takes the task lock plus both project queues. Unrelated tasks in one project run concurrently.

- **Pros.** The lock key (task UUID) survives filing, so a comment op does not need to resolve the project before waiting. It mirrors the vocabulary of R13.
- **Cons.**
  - R13's task scope is about **durable blocking after a crash or conflict**. Nothing approved asks for in-process concurrency inside a project.
  - The shared sidecar index is a project-level read-modify-write (`sidecar-store.ts:79-101`), so project-level exclusion is still needed for those paths. That gives a three-level hierarchy (workspace → project → task) with more deadlock surface.
  - Contention has not been measured. This is a single-user app, and write-safety research advises finer granularity only "if measured contention later warrants" (`write-safety.md` line 74).
- **Failure cases.**
  - *Filing:* the filing must take the task lock **and** both project queues. If a comment op takes the task lock and then a project queue, while filing takes the project queues and then the task lock, they deadlock. A strict global order (projects then task, or task then projects) has to be enforced everywhere.
  - *Workspace reindex:* still needs a workspace-level exclusion, because task locks do not cover reindex.
  - *Receipt race:* unchanged from A. Task locks do not cover a reused ID across tasks.
  - *Startup:* unchanged from A.

### Option C: a commit coordinator (unit of work) that wraps the queues, file durability and SQLite phases, plus a workspace gate

A single internal module, called the `WriteCoordinator` here (the System Map calls it `RecordStore.commit`), executes *command plans*. It owns:

1. **Workspace gate (L0).** An in-process readers/writer lock.
   - *Shared* for every ordinary command, project Reload, project settings, folder operations and recovery recheck/abandon.
   - *Exclusive* for full Reindex and the startup recovery pass. A later export/backup would also take it exclusively (see §6.3).
2. **Project queues (L1).** The existing `ProjectQueue`, acquired for the plan's project set in ascending ID order. After acquiring, the coordinator re-resolves the targets' current projects. If they changed, it releases and retries a bounded number of times, or returns 409.
3. **Receipt lookup and claim.** A lock-free read before L0/L1 (R4, R7). A second read after L1 is acquired. The claim is made at intent insert, where a `UNIQUE` violation causes a re-lookup and maps to `OPERATION_ID_CONFLICT`, `OPERATION_IN_PROGRESS` or the existing ack (R6).
4. **Durable guard check** (R13) and **domain preconditions** (lifecycle, writability, `If-Match`), run inside L1 and before intent (R5).
5. **Phases.** The intent txn, then durable file effects, then optional checkpoint txns, then the completion txn. Each txn is a synchronous `db.transaction`, and all `await`s fall between transactions.
6. **Durable file primitives**, used only by the coordinator:
   - atomic replace (temp `wx` + fsync + rename + **dir fsync**);
   - no-clobber create;
   - verified delete (fingerprint check + unlink + dir fsync);
   - empty-dir removal.
7. **Projections and post-commit invalidation.** Index, FTS, links and tags rows are written in the completion txn. Graph and search caches are invalidated after commit (R17).

Commands such as comment create/edit/delete, file, delete task, delete project, recheck and abandon become small plans. Document update/create/move/capture migrate onto it over time.

- **Pros.**
  - Each ordering rule (R4-R16) is written once.
  - The startup order and reindex exclusion become structural.
  - Fault injection can target the coordinator's phase boundaries, which is #48 acceptance case 1 ([6275518509](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6275518509)).
  - It matches the System Map's decided Q3 seam and gives the System Map's "pause the queues" export a ready hook.
- **Cons.**
  - It is the largest refactor and must land before comments, which the System Map's Q3 already accepts.
  - It can drift into a generic command framework. #49 rejected a generic `/api/commands` *HTTP* framework ([6272152572](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6272152572)), but an internal service seam is consistent with "shared command services".
  - The System Map's `commit(projectId, mutation)` signature is too narrow. It must accept a **set** of projects (filing) and **multi-phase** plans (transfer checkpoint).
- **Failure cases.**
  - *Filing across two projects:* L0 shared, then L1 for {source, target} sorted, then re-resolve. If a concurrent filing moved the task to a third project, release and either retry (bounded) or return `REVISION_CONFLICT` as today (`document-service.ts:663-670`). A long transfer with many comments holds both queues for the whole copy, verify and cleanup. Other writes in those two projects wait. That is acceptable for one user, but see open question Q3.
  - *Workspace reindex vs pending operations:* the exclusive L0 waits for in-flight commands to drain and blocks new ones. Reindex then reads a stable set of pending manifests (R3, R16) and rebuilds only derived tables (R8). Projects created during the run cannot slip past, because project creation takes L0 shared.
  - *Receipt lookup race on retry:*
    - A lost reply is answered by the pre-lock lookup, even after the task moved or was deleted (R7).
    - Concurrent identical retries serialize on L1, and the second sees the completed receipt at the post-lock lookup.
    - A reused ID with different input in another project is caught by `UNIQUE` at intent insert. Because the insert and the lookup happen in one synchronous transaction, **no workspace mutex is needed for receipts**.
    - A pending ID left by a *previous process* must return `RECOVERY_REQUIRED`, and one running *in this process* must return `OPERATION_IN_PROGRESS`. Telling them apart needs an in-memory active-ID set or a process-generation column (spec detail).
  - *Recovery at startup before serving:* startup takes L0 **exclusive**, loads pending records, installs guards, attempts resume for each one through the same plans, runs discovery and manifest-aware sync, runs an empty-index reindex if needed, then releases L0. Only after that do the watcher start and `listen` run. A crash *during* recovery leaves the same durable records, so the next start repeats the pass (each step is idempotent per R11/R12 tables).

### Option D (variant of C, noted for completeness): an in-memory workspace lock for receipt lookup

Serialize every receipt lookup-and-claim through one workspace mutex. **Not needed.** better-sqlite3 transactions are synchronous, and the operational table can enforce `UNIQUE(operation_id)`, so the claim is already atomic in-process. A mutex held across the async precondition reads would serialize all writes in the workspace for no gain.

---

## 5. Recommendation (proposal, not a decision)

**Adopt Option C.** Keep `ProjectQueue` as the L1 primitive. Add a small workspace readers/writer gate. Route comment, filing, deletion, recovery and reindex through one internal coordinator. Do **not** add in-memory task locks; the task scope stays in the durable guards. Do **not** add a receipt mutex. Migrate existing document create/update/move/capture onto the coordinator in later slices, not as a prerequisite.

### 5.1 Lock order

1. **L0 workspace gate.**
   - *Shared:* every command, Reload, project settings, folder operations, recovery recheck/abandon.
   - *Exclusive:* full Reindex, the startup recovery pass, and later an export/backup quiesce.
2. **L1 project queues**, all projects the plan touches, in **ascending project-ID order**, all acquired before any precondition check. Never acquire a queue while holding a higher-sorted one. Never re-enter one you hold.
3. **No in-memory task lock.** Task, comment and path scope is enforced by the **durable pending-operation guard rows** in SQLite, read inside L1.
4. **SQLite transaction (innermost).** Synchronous, contains no `await`, and is never held across file I/O.

Release in reverse order: SQLite, then L1, then L0. Post-commit cache invalidation runs before L1 is released.

### 5.2 Operation order (every covered command)

| Step | Action | Under | Source |
|---|---|---|---|
| 0 | Validate the command shape, Idempotency-Key and UUIDs. 400 `INVALID_COMMAND` on failure | none | R7 |
| 1 | Receipt lookup by operation UUID. Completed: compare fingerprint, then ack or `OPERATION_ID_CONFLICT`. Abandoned: `OPERATION_ABANDONED`. Pending: `OPERATION_IN_PROGRESS` / `RECOVERY_REQUIRED` | none (one sync read) | R4, R6, R7 |
| 2 | Resolve the target project set from stable IDs (task UUID to current project; filing adds the target) | none | R1, R2 |
| 3 | Acquire L0 shared, then L1 sorted | L0, L1 | R1, R2, R3 |
| 4 | Repeat the receipt lookup, then re-resolve targets. If the project set changed, release and go back to 2 (bounded), else 409 | L0, L1 | R1, R2, R6 |
| 5 | Check durable guards for the task/comment set, reserved paths and project. Conflict gives 409 `RECOVERY_REQUIRED` with the blocking op ID | L0, L1 | R13 |
| 6 | Domain preconditions: lifecycle, read-only, Inbox, `If-Match` against disk bytes. 428 or 409 `REVISION_CONFLICT`. Nothing has been persisted yet | L0, L1 | R5, R18 |
| 7 | **Intent txn** (`synchronous=FULL`): insert the op row (`UNIQUE` ID, fingerprint, manifest or inventory, payload) and pending/guard rows. Deletion: mark pending (hidden). On `UNIQUE` violation, re-lookup and map as in step 1 | L0, L1, txn | R5, R8, R9, R12 |
| 8 | **Durable file effects**: atomic replace or no-clobber create plus dir fsync; verified delete plus dir fsync. Transfer: copy, verify, **checkpoint txn** (`destination_verified`), verified cleanup | L0, L1 | R9, R10, R11, R12 |
| 9 | Verify the final on-disk state against the expected fingerprints | L0, L1 | R9, R11, R12 |
| 10 | **Completion txn**: derived index rows (documents/comments/FTS/links/tags), receipt outcome, payload removal, guard release | L0, L1, txn | R9, R11, R12, R15 |
| 11 | In-memory invalidation (graph, search caches). Release L1, then L0. Respond with the body-free ack | — | R17, R7 |

A crash between steps 7 and 10 leaves the pending row. The guards keep blocking, and recovery (startup or `POST /api/recovery/:id/recheck`) re-enters at step 3 with the **original** op ID and runs the per-state tables in R11/R12 and [49/6268372495](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6268372495). Abandonment follows steps 3-5, then a single txn per R15.

### 5.3 Startup order

1. Open the DB and run migrations, setting `synchronous=FULL`.
2. Take L0 exclusive.
3. Ensure the Inbox.
4. Load pending operations and install the guards.
5. Attempt recovery for each pending operation through the coordinator.
6. Run discovery and manifest-aware project sync.
7. Run a full reindex if the index is empty.
8. Release L0.
9. Start the watcher, if it is kept.
10. Call `listen`.

Today the watcher starts before step 6 (`server.ts:51-60`). Under this order it must move after the gate is released. That is a seam requirement, not a watcher-policy change.

### 5.4 Durability gaps the coordinator must close (from §2.5 against R10)

- Set `synchronous=FULL`.
- Add directory fsync after rename, unlink and mkdir.
- Add a no-clobber create.
- Add a verified delete.
- Replace `rm -rf` project removal with manifest-limited deletion.

Do not claim power-loss safety until the supported platforms are verified (R10). Process kill is not proof ([48/6275518509](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6275518509)). Node has no portable `RENAME_NOREPLACE`. `fs.link(tmp, target)`, which fails with `EEXIST`, is one candidate for a no-clobber create. I have not verified it on the supported hosts.

### 5.5 Why not A or B

- **A** works mechanically, but leaves receipt, guard, phase and invalidation logic duplicated across services, and it cannot cover projects created during a full reindex.
- **B** adds a lock level that no decision requires and that the sidecar paths cannot use, and it opens a deadlock surface between task and project locks.

C keeps A's granularity and moves the rules into one place.

---

## 6. System Map scope rulings (proposed)

The System Map was read from its published artifact (§2.7). These rulings concern map #44 only, not the product roadmap.

### 6.1 Domain events: **confirm out of scope**

- #44 lists "Automatic audit/event log of every task change" as out of scope and says comment history is not an audit trail (#44 body).
- #48 says manifests are "temporary recovery metadata, not an activity/event log" ([6261207977](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6261207977)).
- #49 says the receipts decision "does not approve event history" ([6265793037](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6265793037)).
- #46 says event payload and retention are undecided, and editable/deletable comments must stay distinct from durable history ([6261061119](https://github.com/LordHalyana/Backlogger/issues/46#issuecomment-6261061119)).
- The System Map's consumers of events (SSE, activity feed, throughput) belong to phases D and F.

**Caveat.** In-process projection and cache invalidation after each commit **is** in scope, because R17 requires it. The coordinator's completion txn is the natural place to append an `events` row later without re-plumbing. That is a design affordance only, not a commitment.

### 6.2 Native file-watcher policy: **confirm out of scope (policy change), with one in-scope constraint**

- Changing the watcher so it only covers mounted read-only projects (System Map D5) is a behaviour change for existing users (`server.ts:28-31`, `BACKLOGGER_WATCH`). Comments do not need it to be correct.
- #50 already settled that external Markdown changes become searchable after Reload/Reindex with "no new watcher" ([6276990879](https://github.com/LordHalyana/Backlogger/issues/50#issuecomment-6276990879)).
- `docs/design/product-direction.md:128-131` already states the explicit-reload model.

**In-scope constraint.** Whatever the policy, a watcher-triggered `runProject` must go through the coordinator: L0 shared, L1, and manifest awareness (R3, R16). It must also start only after startup recovery (§5.3). The app's own comment writes will fire the watcher and cause a reload of the same project, which is harmless if reload is manifest-aware. Unverified: whether chokidar events from app writes could race a pending op without the L1 hold; the coordinator makes this moot.

### 6.3 Full backup/restore: **confirm out of scope, flagged for human confirmation**

- #44 excludes a "full backup product", and its carried-forward prerequisites say backup/restore is "not certified" (#44 body).
- #49 keeps "stop Backlogger, copy full data directory, restart" as the initial approach and requires the docs to distinguish an index rebuild from a full DB loss ([6267223253](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6267223253)).
- #51 approves only a *bounded* stopped-app restore check that retains retry/recovery behaviour ([6277462185](https://github.com/LordHalyana/Backlogger/issues/51#issuecomment-6277462185)).
- Prior inventory research (`origin/research/backup-recovery-2026-10-16:docs/research/backup-recovery.md`) shows that a full product also needs external mounts, sidecars, project settings and deployment mapping. That is well beyond comments.

**Conflict to surface.** The System Map marks backup/restore as **Decided (D8, D9, Q4)** inside *Phase A*, and the product-direction acceptance criterion 5 requires "Export and restore preserve stable IDs, links, comments and attachments" before a local release (`docs/design/product-direction.md:203`). Ruling it out of scope for #44 is consistent with #44 and #49. It does, however, defer a user-decided Phase A item. It should stay a release gate tracked outside this map, not be dropped. The recommended L0 exclusive mode provides the "pause the queues" hook the System Map's export design needs.

---

## 7. Open questions for the human

1. **Seam before comments.** Accept Option C as the first implementation slice, before comment endpoints (System Map Q3)? Or start with Option A, adding only `runMany` and a reindex gate, and grow it into C?
2. **Full Reindex exclusion.** Is it acceptable that full Reindex (and the startup recovery pass) blocks all writes while it runs, with an exclusive workspace gate? The alternative is reindexing per project under each queue, which cannot honour cross-project duplicate and manifest checks atomically.
3. **Long transfers.** May a filing hold both project queues for the entire copy, verify and cleanup of a large comment set, blocking unrelated writes in those two projects? Or should the queues be released between durable phases, relying on the guards (more complex)?
4. **Re-resolution policy.** When a comment, update or delete finds that its task moved while it waited, should the server retry transparently against the new project (bounded), or return `REVISION_CONFLICT` as filing does today?
5. **Legacy document writes.** Must document create, update, move and capture move onto the coordinator in the same milestone, or later? (They currently make three separate SQLite commits; §2.4.)
6. **Scope rulings.** Confirm §6.1-§6.3, especially §6.3, which defers a System Map "Decided" Phase A item. If confirmed, should backup/restore get its own issue now (System Map "next steps" item 5)?
7. **Durability baseline.** Should switching to `synchronous=FULL` and adding directory fsync apply to *all* writes, not only to the new operational commits? It costs some latency, which is unmeasured, and the CI bench never ran (#45).

---

## 8. Sources

**Issues and decision comments**

- #54 body; #44 body ("Decisions so far", "Out of scope", "Carried-forward prerequisites").
- #48: [6261207977](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6261207977), [6261331459](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6261331459), [6267230898](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6267230898), [6273215040](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6273215040), [6275396250](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6275396250), [6275518509](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6275518509), [6276838558](https://github.com/LordHalyana/Backlogger/issues/48#issuecomment-6276838558).
- #49: [6261471734](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6261471734), [6265793037](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6265793037), [6267223253](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6267223253), [6268127335](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6268127335), [6268372495](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6268372495), [6268573260](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6268573260), [6271610178](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6271610178), [6272152572](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6272152572), [6275973008](https://github.com/LordHalyana/Backlogger/issues/49#issuecomment-6275973008).
- #46: [6261061119](https://github.com/LordHalyana/Backlogger/issues/46#issuecomment-6261061119), [6261130649](https://github.com/LordHalyana/Backlogger/issues/46#issuecomment-6261130649). #47: [6261132673](https://github.com/LordHalyana/Backlogger/issues/47#issuecomment-6261132673). #50: [6276990879](https://github.com/LordHalyana/Backlogger/issues/50#issuecomment-6276990879). #51: [6277462185](https://github.com/LordHalyana/Backlogger/issues/51#issuecomment-6277462185). #45: [6260974452](https://github.com/LordHalyana/Backlogger/issues/45#issuecomment-6260974452). #52 body.

**Code (`259168e`)**

- `packages/api/src/services/project-queue.ts`, `document-service.ts`, `reindex-service.ts`, `inbox-service.ts`, `project-service.ts`, `link-service.ts`, `tags-service.ts`, `import-service.ts`
- `packages/api/src/context.ts`, `startup.ts`, `server.ts`
- `packages/api/src/routes/admin.ts`, `project-reload.ts`, `project-folders.ts`, `documents.ts`
- `packages/api/src/fs/repository.ts`, `sidecar-store.ts`, `project-watcher.ts`
- `packages/api/src/db/database.ts`, `documents-repo.ts`
- `node_modules/better-sqlite3/deps/defines.gypi:16` (main checkout, v12.10.0)

**Docs**

- `docs/design/architecture.md:104-106`
- `docs/design/product-direction.md:120-137, 197-204, 243-247`
- `docs/design/roadmap.md:59-68, 101-103`
- `docs/operations/backup-restore.md:16-64`
- `CONTEXT.md` (glossary only; it has no write-coordination terms). `docs/adr/` does **not exist** (CLAUDE.md points to it).

**Prior research (throwaway branches)**

- `origin/research/write-safety-2026-10-16:docs/research/write-safety.md` (lines 56-58, 66-78)
- `origin/research/backup-recovery-2026-10-16:docs/research/backup-recovery.md`

**System Map**

- claude.ai artifact `DhmmGgPNaxnvd8aaDsHEKm`, published version `1792363700-1e8c`, "revised 2026-10-19". Sections: Findings (commit seam, watcher, backup), Plan phase A, `ProjectQueue`/`ReindexService`/watcher node details. Not stored in the repo.
