# Research #3: task metadata storage and mounted-document safety

Date: 2026-10-16. Issue: https://github.com/LordHalyana/Backlogger/issues/3

Inspected commit: `b7147426ec4f6c7f8b42bd85688480d70e1568af`.
Method: primary-source code review. **No runtime reproduction was performed for the risks in this report.** Recommendations are proposed policy, not an approved product decision. This answers the research question without authorizing migrations or production changes.

## Recommended answer

Use native Markdown frontmatter for newly created personal tasks in an application-owned task project. Retain sidecars for opted-in external documentation; keep unadopted and read-only mounted documents out of the mutable board. Link tasks to external documents instead of converting them automatically. For the initial board, separate the writable task project from read-only mounted reference projects. This avoids introducing per-folder permissions or per-document ownership controls merely to launch Kanban.

Do not claim sidecar editing currently preserves external source files: the implementation rewrites source bodies, and can discard their non-Backlogger YAML frontmatter. Resolve the preservation and archive issues below before promising safe metadata-only editing of external documents.

## Existing behaviour matrix

| Document class | Index authority and identity | Current mutation behaviour | Recovery and external rename | Recommended task policy |
|---|---|---|---|---|
| Valid native frontmatter matching project | Frontmatter wins over sidecar; embedded UUID | Writable project updates native frontmatter even when project mode is sidecar; native archive changes path | Embedded ID survives same-project rename; Markdown retains metadata | New tasks use this model in an owned project |
| Sidecar-backed external Markdown | Used only without valid Backlogger frontmatter; entry keyed by relative path carries UUID | Sidecar project writes body plus sidecar; archive leaves source path unchanged | Requires source plus `.backlogger/index.json`; external rename leaves old sidecar key behind and destination derives a different ID | Preserve as external documentation; explicit adoption only after preservation fixes |
| Derived plain Markdown, no sidecar | Title/body/path-derived ID; defaults to note | Index flag is read-only, but project-level read-only overrides UI/API result; update in writable project adopts via frontmatter or sidecar | Stable only while path stays identical; no durable standalone ID | Browse/reference by default; conversion must be explicit |
| Read-only project containing any of these | Same indexing precedence | Create/update/delete/move blocked by project guard; project settings can enable editing | Project read-only and metadata mode are SQLite settings, not recovered from content alone | Exclude from mutable board; never silently enable editing |
| Valid frontmatter with mismatched project | Repair creates path-derived ID and local project in index, without writing source | Treated as derived by index; writable project update can replace/adopt metadata | Original foreign ID is not the indexed ID | Report mismatch; do not silently convert into a task |

Sources: [index precedence and derived IDs](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/reindex-service.ts#L213-L316), [create/update routing](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L107-L240), [project guard and response flags](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L476-L491), [project persistence](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/db/projects-repo.ts#L14-L22).

## Precedence, adoption and mixed projects

1. Reindex does not choose frontmatter versus sidecar using the project metadata mode. It first accepts valid frontmatter, including a special mismatch branch, then checks the path-keyed sidecar, then derives metadata. Therefore mode is primarily a write policy, not an exclusive content format. [Source](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/reindex-service.ts#L213-L236)
2. Native documents remain native in sidecar projects if their own ID/project matches; newly created documents follow the project mode. This permits mixed representation but does not provide per-document source protection. [Source](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L150-L158), [update branch](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L208-L225)
3. Derived documents are not absolutely immutable. `get` and list responses replace the document read-only flag with project read-only; update adopts derived metadata in writable projects. A label saying “derived read-only” is therefore insufficient as a task safety rule. [Read response](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L78-L84), [adoption](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L208-L225)
4. Toggling project metadata mode changes a SQLite setting only; it does not migrate existing files or sidecar records. A sidecar-indexed document subsequently edited in frontmatter mode can fail native validation because its source has no matching frontmatter. Treat toggling as a mode change, not a conversion wizard. [Project update](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/project-service.ts#L64-L75), [validation](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L495-L531)

## Concrete risks found by inspection

### Source frontmatter loss during sidecar updates or moves

`FsRepository.read` parses YAML away from `body`. `updateViaSidecar` writes `input.body ?? existing.body` using `writeRaw`, even for a title/tag/status-only change. Sidecar move also writes `existing.body`. Thus a source containing another application's YAML frontmatter can lose that YAML. Body-only plain Markdown avoids that specific YAML loss, but metadata-only edits still rewrite its file. This is an implementation finding, not a reproduction result.

Sources: [parsed read](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/fs/repository.ts#L172-L189), [sidecar update](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L280-L305), [sidecar move](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L399-L407).

Recommendation: metadata-only operations must not touch source bytes. Body editing must retain raw frontmatter and unrelated fields; moves should preserve complete file content. Make source editing a separate, explicit operation.

### Sidecar archive is not stable across reindex

Sidecar update records archived status without moving the file. Both reindex paths nevertheless call `statusFromPath`, which changes an archived fallback to active outside the archived path. The sidecar JSON remains archived while SQLite becomes active after reindex. An archived-path source is likewise forced archived regardless of sidecar status. Resolve the authority conflict before board filtering relies on document lifecycle status.

Sources: [sidecar update and unchanged path](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L286-L318), [full/project reindex](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/reindex-service.ts#L97-L159), [normalization](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/reindex-service.ts#L289-L291).

Recommendation: define archive authority per representation and verify archive/reindex round trips. Keep task execution state separate from document archive state.

### Missing/corrupt sidecar and external renames threaten identity

Sidecar load treats invalid JSON or schema mismatch as an empty index. A later set loads that empty index and saves a new one, risking replacement of recoverable metadata. External renames are not reconciled by sidecar ID: lookup uses the new relative path. In-app moves explicitly re-key sidecar records, whereas ordinary filesystem rename does not. Missing metadata therefore changes the visible identity to a path-derived UUID, or hides task classification. Stale sidecar entries are not cleaned by document-row removal.

Sources: [sidecar load/set/rename](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/fs/sidecar-store.ts#L34-L107), [index lookup](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/reindex-service.ts#L229-L242), [removed rows](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/reindex-service.ts#L173-L178).

Recommendation: distinguish absent from corrupt/unsupported sidecars; block writes to corrupt or future-version sidecars and retain originals. Report orphaned entries and require explicit relinking rather than guessing identity from similar text.

## External edits and freshness

The watcher responds to `.md` additions, changes and removals and debounces project reloads; it ignores dot-prefixed paths, so external `.backlogger/index.json` changes do not trigger its normal refresh path. Manual reload can read those changes. Sidecar timestamps come from the entry rather than the source file's modified time, so external body edits are not inherently reflected in the metadata revision token. Native external edits that retain `updated_at` have the same token problem. Fresh body reads alone do not guarantee conflict detection. [Watcher](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/fs/project-watcher.ts#L27-L71), [sidecar timestamps](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/reindex-service.ts#L245-L259), [If-Match](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L192-L211).

Recommend a revision representing both authoritative metadata and current source content, checked inside the serialized mutation boundary. Coordinate with write-safety research rather than introducing a second locking design here.

## Import/export and recovery

Raw export locates the original `.md` and deliberately avoids serialization. This preserves the original file but does **not** include a sidecar document's metadata. Import parses Markdown, detects duplicates only by embedded ID, and delegates creation to a new-ID path. Duplicate replacement updates title/body/tags, not every metadata field. Ordinary Markdown import/export is therefore not a lossless project migration or sidecar backup mechanism. [Raw export](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L87-L105), [import handling](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/import-service.ts#L89-L151), [new IDs](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L107-L119).

Recovery must preserve Markdown, sidecars, and project settings. After SQLite loss, discovered projects are created read-only; missing metadataMode defaults to frontmatter. Therefore do not describe the entire database as disposable without separately preserving project settings. [Discovery defaults](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/reindex-service.ts#L192-L203), [database defaults](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/db/projects-repo.ts#L68-L78).

## Migration contract and acceptance criteria (proposed)

- Do not automatically convert mounted files or all `backlog_item` documents on startup. Detect compatibility, then offer explicit adoption where needed.
- Retain existing native IDs; add task fields only through an explicit, versioned schema. Give missing task metadata a documented read-time default, without eager file rewriting.
- Update native, sidecar, request, response, index, and import schemas together before emitting new fields. Current frontmatter and sidecar schemas enumerate only existing fields; current native updates serialize parsed schema output. Writing future task metadata ahead of schema support is not safe. [Native schema](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/shared/src/documents.ts#L87-L96), [sidecar schema/version](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/shared/src/sidecar.ts#L16-L42), [native parse/write](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L495-L509).
- Before conversion: snapshot originals, validate IDs and collisions, produce a dry-run report, preserve unknown metadata and raw frontmatter, and stop on conflicts or unsupported versions.
- After conversion: restart/reindex and compare IDs, task state, lifecycle status, titles, tags, links and source content; verify a restore on disposable data.
- Sidecar metadata-only change must preserve source byte hash. A read-only operation must leave both source and sidecar unchanged. External rename must not silently attach old task metadata to a different file.
- Keep distinct commands for importing copies and restoring original identities. Do not label the current import route “restore.”

## Decisions still requiring human agreement

1. Approve the initial separation of owned task projects and mounted reference projects.
2. Confirm explicit adoption rather than automatic task conversion for existing backlog documents.
3. Confirm whether sidecar-backed tasks are required in the first board; recommendation is to defer them until preservation, archive and identity handling are reliable.
4. Choose archive/task-state interaction in its dedicated decision ticket.

Research is complete enough to resolve #3 with this recommendation and limitations. It does not resolve the product choices above or claim defects were reproduced. The card-order investigation should assume durable native task IDs for MVP, store order outside derived-only SQLite data, and revisit the representation if sidecar tasks are approved.
