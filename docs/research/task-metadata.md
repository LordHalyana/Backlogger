# Research resolution: minimum task metadata for Backlogger

Issue: https://github.com/LordHalyana/Backlogger/issues/2  
Inspected revision: `b7147426ec4f6c7f8b42bd85688480d70e1568af`  
Research date: 2026-10-16. Method: direct source inspection plus a narrow installed-Zod probe; no production edits or end-to-end execution. Recommendations below are proposals, not human workflow decisions.

## Answer

Extend the existing `backlog_item` document with optional task-specific metadata rather than introducing a second authoritative task record. A board requires identity, project, title (already present), and an effective task state. Preserve `status` for the existing document lifecycle; add `task_status` for execution state. Make newly introduced fields optional in persisted legacy records, and define a deliberate compatibility policy for their absence. Ordinary documents must remain ordinary documents.

This is a cross-boundary change, not simply a frontmatter field addition: current create/update/move paths, sidecar conversion, SQLite summaries, reindex, and import all enumerate or validate their known fields. Unknown task metadata currently fails to round-trip safely.

## Verified current behaviour

| Boundary | Observed behaviour and implication |
|---|---|
| Identity and schema | `backlog_item` is already a supported type. Frontmatter has UUID, title, project, type, lifecycle status, timestamps, tags. Lifecycle values are only draft/active/archived; there are no task fields or frontmatter schema version. [Schema, lines 10–26 and 83–145](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/shared/src/documents.ts#L10-L145). |
| New documents | Creation validates input, generates canonical metadata, defaults lifecycle status to draft, then writes frontmatter or a body-only file plus sidecar. It explicitly builds the indexed record. Adding a field only to an input schema will not persist it. [Create, lines 107–175](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L107-L175). |
| Read and listing | Document GET reads body freshly from disk but gets metadata from the indexed summary. List reads SQLite and currently orders by type/title. Board metadata must therefore be exposed in summaries and indexed, not only stored in files. [Read, lines 65–84](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L65-L84); [repository, lines 4–62](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/db/documents-repo.ts#L4-L62). |
| Native update and move | Update spreads raw metadata into `FrontmatterSchema.parse`, then serializes the parsed result. Move does the same. Archive transitions also affect native file paths. [Update, lines 192–268](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L192-L268); [move, lines 438–460](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L438-L460); [metadata builder, lines 495–509](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L495-L509). |
| Sidecar | Sidecar entries have a separate closed object schema; index version is already 1. Update and frontmatter-to-sidecar conversion explicitly reconstruct known fields. A task extension must cover both representations if sidecar tasks are supported. [Sidecar schema](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/shared/src/sidecar.ts#L16-L42); [update, lines 280–335](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L280-L335); [conversion, lines 539–549](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L539-L549). |
| Reindex/reload | Valid native frontmatter wins; otherwise a sidecar entry can supply metadata; otherwise the document is derived as a note with a path-derived ID. Reload explicitly maps metadata into the index and rebuilds links/tags. A newly required task field would make old task metadata invalid and could therefore cause fallback to a different type/identity. [Metadata resolution, lines 213–286](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/reindex-service.ts#L213-L286); [reload, lines 144–177](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/reindex-service.ts#L144-L177). |
| Import | New/copy import extracts only title/type/status/tags/body, then creates a new ID. Replace of an existing same-project ID updates title/body/tags, not even imported lifecycle status. Unknown task fields will be dropped unless import policies change. [Import, lines 89–151](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/import-service.ts#L89-L151). |
| Export | Raw export streams the actual source file. Native frontmatter is included; sidecar metadata is not automatically injected into a body-only source file. A raw export is therefore not a self-contained task export for sidecar tasks. [Raw route, lines 67–84](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/routes/documents.ts#L67-L84). |

### Unknown metadata is not currently safe extension storage

The repository uses ordinary `z.object(...)` schemas without passthrough. A narrow probe against its installed Zod confirmed that parsing `{title: "Task", task_status: "todo"}` with a schema containing only `title` returns only `{title: "Task"}`. Combined with the cited update/move serialization, this establishes that unknown frontmatter keys are stripped on those native rewrite paths. Reindex ignores them in its parsed metadata without itself rewriting the source. Sidecar validation and explicit reconstruction likewise do not retain arbitrary additions. This is a source-derived data-loss risk, not an end-to-end reproduced ticket edit.

Do not prepopulate user files with proposed task fields and assume the current app will preserve them. Decide a preservation policy before implementation: retain validated known task fields everywhere, and preferably preserve unknown namespaced extension data without allowing it to override canonical fields. Blind passthrough alone is not a complete compatibility policy.

## Recommended minimal model

| Candidate | Necessity | Proposed treatment |
|---|---|---|
| Existing UUID/project/title/type | Required now | Reuse unchanged. A board references the same document ID; no duplicate task identity. |
| `task_status` | Required effective board value | Optional on disk for legacy compatibility; validated when present; allowed only on backlog items. Exact states and absent-value behaviour go to the human task-state decision. |
| `priority` | Optional later or alongside filters | Bounded enum if adopted; absence means unspecified, not an inferred urgency. Exact values are a product choice. |
| `due_date` | Optional for Today/calendar | Date-only YYYY-MM-DD with actual calendar validity checks. No timezone conversion for a date-only deadline. Provide an explicit clearing operation distinct from omission in updates. |
| Ordering/rank field | Only needed for manual order | Defer representation to ordering research. Board may initially use a deterministic title/ID order. Never overload priority or lifecycle status as rank. |
| Metadata schema version | Migration infrastructure, not user input | Consider an additive frontmatter version marker with absent=legacy semantics; do not conflate it with the existing sidecar envelope version. Unknown future versions must not be silently rewritten. Pin exact migration behaviour before changing the sidecar version. |
| Assignee/workspace/user IDs | Not required for single-user board | Defer identities and teams. Reuse project ownership for now instead of inventing placeholder users. |
| Completion timestamp, dependencies, estimates, recurrence | Not required for first board | Add only through later behaviour-driven slices. Completion notes can remain Markdown body content. |

Flat optional fields are the smallest fit with the current schema. A nested task block is also defensible for namespacing, but adds another shape without solving the preservation problem by itself. Choose one representation and normalize it once through shared parsing/serialization; do not support two new competing forms.

### Alternatives not recommended for this milestone

- Separate authoritative task file linked to every backlog document: introduces dual identities, creation/deletion synchronization, orphan handling, and two places to inspect one piece of work.
- New document type `task`: splits existing backlog content and requires conversion without a demonstrated need.
- Reusing draft/active/archived as board states: confuses work completion with existing document lifecycle and path movement.
- SQLite-only task metadata: disappears on reconstruction from content; contradicts the durable-file design.
- Tags encoding state or priority: avoids schema work superficially but permits contradictory states and makes validation/filter semantics implicit.

## Compatibility requirements for implementation tickets

1. Existing backlog items parse with their original identity and body even when every new task field is absent; no eager mass rewrite.
2. Human-selected default/adoption policy determines effective board state. Do not infer done from archived or in-progress from active.
3. Ordinary notes stay notes even if they contain task-looking headings or unknown keys. Invalid task extensions must produce a useful diagnostic without quietly turning a valid core record into a new path-derived note.
4. Supported task fields survive native create/edit/move, supported sidecar operations, reload, full reindex, restart, and import modes with explicitly documented semantics.
5. Update omission preserves a field; clearing removes it. Invalid state/date/priority is rejected without overwriting valid content.
6. Existing lifecycle archive behaviour remains separate; board visibility of draft/archived records is a human choice.
7. Task metadata is present in list/get projections. SQLite remains rebuildable for task content; schema changes alone do not complete this requirement.
8. Raw export retains its current meaning. If portable task export is added, make its sidecar inclusion explicit rather than silently changing raw source download.
9. Downgrading to an older binary is unsafe for new metadata under current stripping behaviour; document this or implement version-aware write refusal. A schema marker alone cannot teach old binaries to preserve fields.

## Decisions handed off, not answered on the user's behalf

- Task-state decision: state names, initial state, whether absent state means board inclusion or explicit adoption, treatment of draft backlog items, and whether done can be reopened.
- Lifecycle decision: archived visibility, completion versus archival, and preserving task state across unarchive.
- Storage decision: whether first-board editing supports sidecar projects or initially only native projects; native-frontmatter precedence inside a sidecar project; portable export expectations.
- Ordering decision: whether manual order is required for first board, scope of rank (project/column), ties and fallback ordering.

## Resolution assessment

The technical research question is answered: an additive task-specific extension of backlog_item is the narrowest compatible route, but end-to-end metadata preservation must be implemented. The human workflow decisions remain explicitly open. No production changes were made. Recheck this analysis after schema, import, sidecar, or indexing changes; it is pinned to the inspected revision.
