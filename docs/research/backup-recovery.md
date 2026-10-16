# Backlogger #5 — What exactly must a task backup preserve?

Research date: 2026-10-16. Inspected commit: `b7147426ec4f6c7f8b42bd85688480d70e1568af`. Parent: [issue #1](https://github.com/LordHalyana/Backlogger/issues/1). Decision: [issue #5](https://github.com/LordHalyana/Backlogger/issues/5).

## Answer

A complete current backup must preserve the data directory **and every external project source**, including `.backlogger/index.json`, plus deployment/mount configuration and the application revision. SQLite is partly derived, but its project rows are authoritative configuration and must not be treated as a disposable cache. Raw Markdown download/import is not an identity-preserving restore mechanism.

Evidence level: source inspection only; the proposed empty-install experiment below has **not been run**. This resolves the inventory/design question, not a claim that operational recovery is already verified.

## Backup inventory

| Data | Preserve | Reconstruction limits |
|---|---|---|
| Native project Markdown | Complete tree, frontmatter, paths, archive folders, bytes | Native IDs/tags/type/status/timestamps come from valid matching frontmatter; paths affect archive state. [R1] |
| Sidecar-managed Markdown | Source files AND project-relative `.backlogger/index.json` | Sidecar contains IDs, type, status, tags, optional title and timestamps absent from raw source. Its keys are project-relative paths. [R2] |
| Plain unadopted Markdown | Source tree and original project IDs/relative paths; preserve filesystem timestamps where possible | IDs derive from project-relative path; metadata defaults to note/empty tags. Creation and modification times derive from filesystem birthtime/mtime, which may change on restore. [R1, R3] |
| SQLite project rows | Database with name, description, read-only flag, metadata mode, project IDs and timestamps | Auto-discovery restores only ID-derived name, null description, read-only=true, fresh timestamps, and default frontmatter mode. It does not infer the previous project configuration. [R4, R5] |
| SQLite document/search/tag/link indexes | Include in full operational backup, but distinguish as rebuildable projections | Reindex rebuilds document rows, links and tags from file/sidecar sources, invalidating graph cache. Rebuilding cannot recover missing sources or missing project settings. [R1] |
| User templates | `data/templates/` Markdown | User templates can override built-ins by ID; losing them changes future document creation. Preserve application revision for built-in templates. [R6] |
| External mounts/symlink targets | Each actual external source tree, its sidecar, and mapping to its original project ID | Compose overlays six host directories beneath `/app/data/projects`; backing up only the underlying named volume does not include those separate host sources. Root-level project symlinks require target contents, not merely the symlink. [R5, R7] |
| Deployment description | Effective Compose configuration/environment, host-source mapping, application commit/image identity | Needed to reconnect sources correctly on another machine. This is deployment metadata, not hypothetical plugin secrets. [R7, R8] |

Preserve complete project trees, including linked local assets if present; the index walker only indexes Markdown and cannot reconstruct other files. Nested symlinks are skipped by that walker. [R3]

## Three different promises

1. **Raw-document export — exists:** `GET /api/documents/:id/raw` streams the on-disk file unchanged. For sidecar documents this omits Backlogger metadata. [R9]
2. **Portable project/workspace archive — proposal, not an existing API:** source trees, sidecars, templates, a versioned project-settings manifest, file checksums and project-to-source mapping. Must specify preserved IDs, archive paths, settings, and conflict rules. Do not describe a raw export as this capability. The route registrations expose raw export and import, not workspace archive/restore. [R9, R10]
3. **Full operational backup — current simplest supported practice:** stop Backlogger and coordinate a pause of other writers to mounted sources; copy the full data directory and all external trees; record configuration/version; restore all of them before starting. Existing operations docs prescribe stopping the app and copying its data directory, but do not enumerate external mounts. SQLite is configured in WAL mode, reinforcing that a live copy of only the main database file is not the intended procedure. [R7, R11]

In an empty installation, the current import service calls document creation and generates a new ID and timestamps rather than restoring the imported ID. Existing-ID matching only helps duplicate handling when that ID already exists in the target project. Creation also chooses new filenames/folder placement. Consequently raw export followed by import is not backup restoration, even for native frontmatter records. [R12]

## Exact reconstruction gaps and source discrepancies

- **Losing SQLite changes write policy:** even if saved sidecars recover document IDs, auto-discovered projects default to `metadataMode=frontmatter` and `readOnly=true`. Reindex consumes sidecar entries regardless of the project mode, so a successful document listing can hide the lost policy. Restore settings before permitting writes. [R1, R4, R5]
- **Project timestamp restoration is not available through ordinary update API:** updates accept name, description, readOnly, metadataMode; the service generates updated_at. A JSON listing plus manual API recreation does not exactly reproduce historical project timestamps. Retain SQLite for exact current operational restore. [R13]
- **Sidecar corruption can look like success:** loader returns an empty sidecar on invalid JSON/schema, causing ordinary metadata derivation downstream. Health or document count alone cannot prove recovered identities. Validate sidecar shape/checksums and compare original IDs explicitly. [R2, R14]
- **Relative paths matter:** plain-derived IDs hash the project-relative path; changing only the absolute host mount source should not change those IDs, but changing project ID or relative path does. Sidecar keys and archive-state inference also depend on paths. [R1, R3]
- **Existing backup documentation is stale:** its final paragraph says invalid/mismatched frontmatter is skipped; current code repairs mismatched project metadata into a read-only derived ID and falls back to sidecar/plain derivation when frontmatter is invalid. Do not use “no skipped files” as the sole integrity check. [R1, R11]
- **Links are rebuildable but identity preservation must be checked:** wiki links are resolved by title with newest updated_at chosen, not universally by immutable target ID. Duplicate titles and filesystem-derived timestamp changes can alter a resolution after reconstruction. Include duplicate-title cases in a later link-recovery check; do not promise all link targets are intrinsically stable. [R15]

## Proposed disposable empty-install restore experiment — NOT RUN

Use the pinned application revision and two isolated local data roots (source and restore). Use temporary external source directories instead of the real Compose host paths. Keep all tests away from user data.

### Arrange source installation

1. Create native project `restore-native` via `POST /api/projects` with a non-default display name and description. Create two `backlog_item` records through `POST /api/projects/:projectId/documents`, with distinct titles, tags, a known searchable sentinel and a wiki link between them. Archive one using the supported document archive route. Record IDs and raw files. [R10, R16]
2. Mount a separate temporary directory as `restore-mounted`, containing a nested plain Markdown document. Restart for discovery; update that project with `PUT /api/projects/:id` to `metadataMode: sidecar`, `readOnly: false`, and a distinctive name/description. Adopt/edit through `PUT /api/documents/:id` and add a tag; confirm original source has no injected Backlogger frontmatter and metadata exists in the sidecar. Record the resulting stable ID. [R13, R17]
3. Keep a second plain document unadopted to exercise path-derived identity; keep another project read-only and an empty project to verify settings and empty-folder recovery.
4. Add a user template with valid template frontmatter to `data/templates/`, then `POST /api/admin/reload-templates`. Record `GET /api/templates` and the template response. [R6, R18]
5. Capture expected JSON from `GET /api/projects`, each project document list, each document GET, backlinks, tags, project graph and search; record file SHA-256, relative paths, sidecar JSON and relevant filesystem timestamps. API routes are exposed in R10; searches accept q/projectId in R19.

### Full operational restore arm

6. Stop the source app and all writers to the temporary mounted sources. Copy the complete data directory, the external source trees including sidecars, and effective mount configuration into a backup. Preserve timestamps where supported. Retain source IDs and exact project-to-mount mapping.
7. Restore into empty destination paths. Repoint host paths to the restored external copies while keeping the same container project IDs; start the same revision. Do not start while required mount sources are missing, because startup sync reconciles missing files. [R8]
8. Check `/health`, then compare public API snapshots and raw bytes. Verify native/sidecar IDs, body, tags, lifecycle state, settings and templates; search sentinel, backlink/graph relationships and archived placement must match. Verify read-only project mutation rejection using a disposable record.
9. Run `POST /api/admin/reindex`, repeat checks, restart again, and repeat. In the restored editable sidecar project perform one safe title/tag edit and verify no frontmatter was injected into the source. This detects lost metadata-mode settings that a read-only listing misses. [R18, R17]

### Minimal recovery and negative-control arms

10. In a separate empty destination, restore the same source trees/sidecars/templates without SQLite. Expect native and sidecar document IDs to survive at unchanged paths, but project configuration and project timestamps to differ. Explicitly compare those differences instead of declaring exact restoration. Plain file timestamps may differ. [R1, R4, R5]
11. In another disposable copy omit one sidecar, then repeat with invalid sidecar JSON. Expect loss of sidecar-only metadata and potentially replaced IDs. Confirm integrity verification catches this even when app startup succeeds. [R14]
12. Finally import one raw native export into a newly created empty project and compare its ID/path/timestamps; expected result is new identity. This confirms why download/import is not the restore path. [R12]

The proposed experiment validates current records only. Task workflow state, board rank, comments and planner entries are not implemented at this revision; no recovery claim for those fields can be tested yet.

## Constraints for future task implementation

Recommendations, not implemented decisions:

- Persist task ID, task state, ordering value and any dependency/document references in authoritative frontmatter or the selected sidecar schema, not only SQLite.
- Version metadata formats and preserve unrecognized extension data through reads/writes/export, rather than silently discarding future fields.
- Define board rank scope and its deterministic tie-break; restore tests must compare resulting order after deleting/rebuilding derived indexes.
- Include future comment/planner source records in the inventory when introduced; their references must use preserved identities.
- Do not use path-derived IDs for adopted actionable tasks expected to survive rename/move.
- Require the empty-install restore check as a milestone gate before claiming portable recovery; keep scheduling/encryption/cloud backup services out of this scope.

Suggested follow-up implementation outcomes: correct backup/restore documentation with external-source coverage; verify stopped-app full restore; report invalid sidecars before users resume editing. A portable manifest/archive format is a later product decision, not necessary to resolve this inventory ticket.

## Primary sources (pinned)

- R1: [Reindex reconstruction and metadata precedence](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/reindex-service.ts#L80-L119), [metadata and derived IDs](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/reindex-service.ts#L213-L316).
- R2: [Sidecar schema](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/shared/src/sidecar.ts#L12-L49).
- R3: [Filesystem walker and stat-derived timestamps](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/fs/repository.ts#L280-L320).
- R4: [Project database fields/defaults](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/db/projects-repo.ts#L4-L23), [insert defaults](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/db/projects-repo.ts#L75-L90).
- R5: [Startup auto-discovery](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/server.ts#L156-L208).
- R6: [Template loading and precedence](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/templates/registry.ts#L49-L126).
- R7: [Named volume plus actual external mounts](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/docker-compose.yml#L1-L44).
- R8: [Runtime path and startup synchronization](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/server.ts#L20-L94).
- R9: [Raw document export](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/routes/documents.ts#L67-L84).
- R10: [Public API registrations](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/app.ts#L36-L76).
- R11: [Current backup documentation](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/docs/operations/backup-restore.md), [SQLite WAL configuration](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/db/database.ts#L20-L31).
- R12: [Import duplicate detection/create path](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/import-service.ts#L89-L155), [new ID/path/timestamps](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L107-L158).
- R13: [Project update schema](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/shared/src/projects.ts#L22-L39), [update timestamp handling](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/project-service.ts#L64-L75).
- R14: [Missing/corrupt sidecar fallback](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/fs/sidecar-store.ts#L26-L48).
- R15: [Title-based link resolution](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/link-service.ts#L29-L61).
- R16: [Document routes](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/routes/documents.ts).
- R17: [Sidecar update branch](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L185-L255).
- R18: [Reindex/template reload endpoints](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/routes/admin.ts#L13-L37).
- R19: [Search parameters](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/routes/search.ts#L6-L20).
