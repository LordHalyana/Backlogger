# Research resolution #8: durable board card ordering

Issue: https://github.com/LordHalyana/Backlogger/issues/8  
Backlogger revision: `b7147426ec4f6c7f8b42bd85688480d70e1568af`  
Method: primary-source inspection, comparison of persistence operations, and two isolated numerical probes. No board implementation, production changes, or runtime persistence tests were performed here. Read alongside the task-model, storage-policy and write-safety research.

## Recommendation and assumptions

**Manual ordering is not yet approved.** The smallest first board can use deterministic automatic ordering and no new persisted order field. If manual card ordering is approved, use **a variable-length fractional string rank owned by each native task**, scoped to its project and task state. Write the task's state and rank together in its existing Markdown record. Reuse a maintained, pinned key generator rather than implementing numeric floating-point midpoints.

This recommendation assumes one board per project, one state/column per task, one application writer process, and application-owned native task files. Native ownership is a proposed policy from #3, not a settled product choice. Arbitrary multi-board placements would require a different ownership model. The current concurrent-write defects are not fixed; the serialization and revision contract below is a prerequisite, not an existing guarantee.

## What exists today

- Project document lists sort by type/title, with no persisted rank or UUID tie-breaker: [documents repository lines 56–80](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/db/documents-repo.ts#L56-L80).
- The shared metadata and summaries have no ordering field, and parsing/rewrite boundaries do not preserve arbitrary additions: [schemas lines 83–145](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/shared/src/documents.ts#L83-L145), [metadata builder lines 495–509](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L495-L509).
- Native writes replace one Markdown file through a temporary file, sync, and rename; this does not make multiple files atomic: [repository lines 192–222](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/fs/repository.ts#L192-L222).
- Reload rebuilds indexed fields from authoritative records. It must include rank explicitly to preserve board ordering: [reindex lines 144–177](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/reindex-service.ts#L144-L177).

## Alternatives compared

| Scheme | Typical move writes | Advantages | Cost or failure boundary |
|---|---|---|---|
| Consecutive integers 1,2,3 | Potentially many task files | Obvious to humans | Moving a card may renumber every later card; interrupted renumber is partially applied |
| Gapped safe integers | Usually one task file | Simple validation; human-readable; no dependency | Gaps eventually exhaust; then compaction rewrites multiple tasks or move must fail safely |
| Floating-point midpoints | Usually one task file | Superficially simple | Finite precision eventually produces a boundary value; do not use as an unbounded rank |
| Variable-length fractional strings | Usually one task file | No fixed numeric gap to exhaust; state and order share one atomic record | Need canonical validation/comparison; keys can grow; duplicates and configured size limits require a defined repair boundary |
| Ordered-ID list in board Markdown frontmatter | One board file for same-column reorder | Entire list replaced atomically; easy to inspect | Cross-column move also changes the task state unless board file becomes state authority; adds a second authoritative record, orphan references, reconciliation, and project-wide write contention |

An ordered-ID file **can be Markdown**, so it is not rejected for using JSON. It is rejected for the initial model because the proposed task-owned state plus board-owned placement gives a cross-column move two authoritative writes. Putting state only in the board avoids that split but makes individual task Markdown less self-contained and changes #2's model. Copying state into both is not an acceptable shortcut.

String fractional indexing is supported by the primary implementation's documented `generateKeyBetween` and case-sensitive ordering: [Rocicorp README](https://github.com/rocicorp/fractional-indexing/blob/main/README.md). Inspected README blob SHA: `9564c339115a9ec5f69e38b78b5afc644b775827` (retrieved from main; a package version has **not** been selected). The documentation explains prepend/append generation and variable-length keys. Pin and verify the chosen library version before implementation; do not permit arbitrary locale comparison or custom alphabets in the first format.

## Proposed deterministic persistence rules

1. Persist optional `board_rank` as a quoted string in each eligible native task's frontmatter. Treat it as position within `(project_id, task_status)`, not a global priority. Validate canonical keys for the selected generator.
2. For ranked cards, compare rank using ordinary case-sensitive ASCII/byte ordering, then stable UUID. SQLite uses an equivalent binary collation; JavaScript uses `<`/`>`, not locale-sensitive comparison. Duplicate keys remain readable and deterministic via UUID.
3. Missing or invalid ranks sort after valid ranks, by stable UUID. This avoids mass-writing old backlog items and prevents title edits from unexpectedly moving unranked cards. Surface invalid rank diagnostics, preserve source bytes during indexing, and do not downgrade the core document to a derived note because its rank is bad.
4. A no-manual-order board can instead sort by title then UUID; keep that explicit automatic mode separate from the ranked-mode comparator.
5. Do not silently assign ranks to all files during startup/reindex. When an unranked task is deliberately moved into the ranked region, give only that task a rank. Unranked tasks remain a clearly indicated tail; placement between unranked tasks is unavailable until a separate explicit normalization operation is supported. This is an MVP limitation requiring product acceptance.
6. Send move intent as task ID, destination state, and neighbouring IDs plus relevant revisions. The server validates neighbours and computes rank from current state under the project queue. Do not trust a stale client-generated rank or silently reinterpret stale neighbours.
7. Write destination state and new rank in the same native Markdown replacement. Update the SQLite projection after committing the file. Startup/reindex derives order from committed task files; it must not depend on a browser cache or SQLite-only rank.
8. Imports must deliberately preserve valid ranks or discard/reassign them under a stated policy. Copied tasks with preserved rank can tie; UUID resolves display deterministically. Reload/reindex does not itself repair ties. Task deletion needs no updates to other tasks.

## Worked examples

These are design examples using the default keys documented by the primary implementation, not execution of that library here.

- Initial column: A=`a0`, B=`a1`, C=`a2`. Insert D between B and C: D=`a1V`. Only D changes. Order is A, B, D, C.
- Move C before A: C=`Zz`. Only C changes. Order is C, A, B, D.
- Move D into an empty destination column: set its destination state and rank `a0` together. The rank may also exist in another column because the scope differs.
- Legacy L has no rank: it appears after ranked cards using the UUID tail rule. Move L between A and B: assign a key between their current ranks; only L changes.
- External edit gives B and D the same `a1`: display them by UUID, report a collision. A request to insert strictly between these equal-key neighbours cannot use the generator directly. Reject that ambiguous move with a repair-required response, preserving all files. Moving either tied card into an available distinct interval is a possible one-record repair, but do not silently choose a new position for the user.

## Numeric exhaustion and compaction boundary

Isolated Node probes (algorithm demonstrations, not Backlogger benchmarks) found:

- Safe integer gap 0..1024 allows ten repeated floor-midpoint insertions into the leftmost remaining gap, then the interval is 0..1 and has no integer interior.
- Binary floating-point midpoint between 1 and 2 permits 52 repeated leftmost insertions before the next midpoint equals a boundary.

A larger integer gap postpones this problem; it does not remove it. Integer schemes must also check safe-integer range before prepend/append arithmetic.

For string ranks there is no fixed numeric-gap exhaustion, but a practical maximum length must be chosen. Proposed initial guard: 128 ASCII characters, explicitly an engineering policy rather than a measured requirement. If generation exceeds the supported length, or neighbours have equal rank, reject the move without changing state or files and identify repair as required. Invalid external keys are not inputs to generation.

**Do not implement automatic in-place rebalance in the first ordering slice.** Explicit normalization/rebalance rewrites multiple authoritative task files, and the existing atomic-one-file writer cannot guarantee all-or-nothing completion. Before enabling it, implement a durable plan/journal listing affected IDs, old/new values and revisions; serialize the project, persist intent before changes, recover interrupted work deterministically before serving/reindexing, and validate conflicts rather than overwriting external edits. An alternative is a revised single-board-file authority model, but that is a separate model decision.

Until that recovery feature exists, normal one-card moves work, while collisions, unranked-tail ordering, or length exhaustion expose a safe limitation instead of invoking an unsafe hidden migration. If unrestricted reordering of imported/legacy cards is required on day one, normalization and its recovery protocol become part of the first release scope rather than pretending rank generation alone solves them.

## Concurrency contract and acceptance evidence needed

The write-safety investigation reproduced lost accepted updates. Use its proposed single-process per-project mutation queue shared with reindex; inside the queue read current records, validate task/board-neighbour revisions and permissions, compute rank, write, then index. A UUID tie-breaker prevents nondeterministic display; it does not fix lost updates or provide collaborative merging. Two-server ownership and arbitrary concurrent filesystem writers remain outside the initial guarantee.

Required implementation checks:

- Same-column and cross-column moves survive restart and full index reconstruction with the same order.
- The cross-column operation changes state and rank together, with no intermediate two-record state.
- Concurrent moves are serialized; stale anchors produce a clear conflict, not silent positional drift.
- Missing, invalid and duplicated ranks render deterministically without rewriting source records.
- A rejected rank-generation/validation operation changes no state or files.
- No reload, title edit, import or move strips supported rank metadata.
- Failure after file commit but before SQLite update is corrected by recovery/reindex from committed files.
- Any later rebalance has injected-interruption recovery tests, not merely normal-case order tests.

## Human choices still open

Whether manual order is required initially; approval of native-owned task-only editing; append/prepend defaults for creation and cross-column moves; whether the unranked-tail limitation is acceptable; and whether repair/normalization belongs in the first release. The technical recommendation does not settle those product choices.
