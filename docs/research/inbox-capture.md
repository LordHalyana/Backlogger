# Capture and project filing: identity and recovery review
Research for #30, reviewed and approved by the user on 18 October 2026. Source inspection at commit 7d0d4c0a882f542c4985920118440824c98d9366. No runtime reproduction or production implementation.

## Findings
- Existing move only accepts a folder and always constructs destination beneath summary.project_id. It preserves UUID within that project. It is not cross-project filing. Native move writes destination, ignores failure deleting source, then updates index; it is not a crash-safe transfer protocol. [document-service.ts](https://github.com/LordHalyana/Backlogger/blob/7d0d4c0a882f542c4985920118440824c98d9366/packages/api/src/services/document-service.ts#L466-L600)
- Import is not a transfer primitive: duplicate detection applies only within target project, otherwise create generates a new UUID, timestamps and rebuilt metadata. Copy/import then delete loses identity and can lose unsupported metadata. [import-service.ts](https://github.com/LordHalyana/Backlogger/blob/7d0d4c0a882f542c4985920118440824c98d9366/packages/api/src/services/import-service.ts#L90-L166), [create](https://github.com/LordHalyana/Backlogger/blob/7d0d4c0a882f542c4985920118440824c98d9366/packages/api/src/services/document-service.ts#L151-L210)
- Moving bytes externally to another project without changing project frontmatter does not preserve indexed identity: reindex synthesizes a path-derived UUID for mismatched project metadata. [reindex](https://github.com/LordHalyana/Backlogger/blob/7d0d4c0a882f542c4985920118440824c98d9366/packages/api/src/services/reindex-service.ts#L226-L297)
- Stable UUID is necessary but insufficient for links. Backend wiki resolution is global by lowercase title, most recently updated wins. UI wiki navigation searches only current-project titles. Filing unchanged-title/unchanged-ID content into another project can therefore break UI wiki navigation while backend backlinks still resolve. Duplicate titles already make resolution ambiguous. This is source-inspected, not reproduced. [backend](https://github.com/LordHalyana/Backlogger/blob/7d0d4c0a882f542c4985920118440824c98d9366/packages/api/src/services/link-service.ts#L35-L52), [UI](https://github.com/LordHalyana/Backlogger/blob/7d0d4c0a882f542c4985920118440824c98d9366/packages/web/src/hooks/useWikiLinkNavigation.ts#L19-L48), [catalog](https://github.com/LordHalyana/Backlogger/blob/7d0d4c0a882f542c4985920118440824c98d9366/packages/web/src/lib/links.ts#L19-L28)
- Relative .md links resolve against current document path; preview looks up resulting path in supplied document list. Moving a file changes resolution base and incoming paths. Neither existing move nor preview rewrites paths. Images/other relative URLs lack a corresponding relocation mechanism in the inspected renderer/preview. Do not promise attachment portability. [preview](https://github.com/LordHalyana/Backlogger/blob/7d0d4c0a882f542c4985920118440824c98d9366/packages/web/src/components/DocumentPreview.tsx#L13-L80), [renderer](https://github.com/LordHalyana/Backlogger/blob/7d0d4c0a882f542c4985920118440824c98d9366/packages/shared/src/markdown.ts#L17-L35)
- Queue is per-project and allows different projects concurrently. inDocumentQueue chooses project before joining queue, then rereads document without verifying project still matches queue. Introducing project transfer must revalidate/retry this assumption or a queued old-project operation could mutate destination outside its queue. [queue](https://github.com/LordHalyana/Backlogger/blob/7d0d4c0a882f542c4985920118440824c98d9366/packages/api/src/services/project-queue.ts#L1-L23), [document queue](https://github.com/LordHalyana/Backlogger/blob/7d0d4c0a882f542c4985920118440824c98d9366/packages/api/src/services/document-service.ts#L585-L600)
- Native mutations and project reload use queue, but full run() and ProjectService.delete/update do not. A transfer cannot claim all lifecycle operations protected without explicit coordination. [reindex](https://github.com/LordHalyana/Backlogger/blob/7d0d4c0a882f542c4985920118440824c98d9366/packages/api/src/services/reindex-service.ts#L86-L146), [projects](https://github.com/LordHalyana/Backlogger/blob/7d0d4c0a882f542c4985920118440824c98d9366/packages/api/src/services/project-service.ts#L67-L100)
- Project-root symlinks are explicitly allowed; destinations can be different filesystems. Current atomic writes replace a single file with same-directory temp+rename, not two project files. A transfer design needs recovery instead of assuming a cross-project rename is atomic. [resolver](https://github.com/LordHalyana/Backlogger/blob/7d0d4c0a882f542c4985920118440824c98d9366/packages/api/src/fs/path-resolver.ts#L166-L210), [write](https://github.com/LordHalyana/Backlogger/blob/7d0d4c0a882f542c4985920118440824c98d9366/packages/api/src/fs/repository.ts#L195-L249)

## Options and recommendation
1. Direct project capture only: smallest increment, no new transfer risk, but not projectless capture.
2. Native Inbox project plus dedicated same-ID filing: best fit for intended flow, but transfer is a real bounded feature. Only editable native projects initially. Preserve source until destination is verified; durable operation record/recovery or equivalent explicit protocol; lock both projects in canonical order; reject collisions and stale revision; coordinate project deletion/reload; preserve metadata and account for links.
3. Virtual Inbox flag in existing projects: avoids physical transfer but still requires project selection and introduces new metadata, so weaker fit for capture-before-organizing.

Recommend option 2 if capture-before-organizing is essential, with direct-to-project capture whenever user already knows destination. Do not quietly scope link portability out. Either implement a defined minimal cross-project link/navigation rule, or explicitly limit and communicate link-bearing filing until that decision is resolved. Avoid a broad integration, attachment, or custom state project.


## User-selected direction

Option B: a normal native Markdown-backed Inbox project, plus direct capture into a known project. The user explicitly selected B because future API or MCP clients, including LLM clients, should be able to create and update tickets/comments quickly.

Global capture defaults to Inbox; project-context capture can go directly to that project. Captures are ordinary backlog items, using current draft document status and todo task state. Filing preserves identity, creation time, body, task state and supported metadata, while updating project/path and revision. Inbox is a triage destination, not a new task state.

Direct project capture is a useful delivery increment before same-ID filing. Delivery sequencing, precise UI behaviour and the exact transfer protocol remain specification work.

A separate projectless/unfiled record model was also considered: it needs changes to required project metadata, storage, indexing and query assumptions. The existing schema and service contracts make the native Inbox project the smaller fit. Direct-project capture alone is smaller still, but does not meet capture-before-organizing.

## API/MCP implications (design constraints, not integration implementation)

- Capture, update and filing should be shared application commands callable without UI state. A future API/MCP adapter should call the same validation, permission and persistence boundary, not write Markdown directly.
- Return stable IDs and current revisions. Future automated updates should supply revision preconditions and receive explicit conflicts; do not silently change the existing missing-If-Match API contract in this research.
- Design retry-safe creation/filing with a request identity or equivalent mechanism. Disabling a button does not prevent duplicate tool retries. The exact deduplication contract and persistence are not yet implemented or selected.
- Distinguish copy from move and include machine-readable outcomes for validation failures, conflicts and unsupported destinations.
- Comment creation/update semantics remain owned by the later progress-note research. Do not preselect a comment schema, authorship model or append/edit policy here.
- MCP transport, authentication, permissions for external clients and agent automation are a later integration milestone. This decision does not expose the service or grant autonomous write access.

## Proposed acceptance/failure matrix

| Case | Required outcome for the selected design |
|---|---|
| Title missing, blank after trimming, or outside supported length | Validation error; no new file; caller retains input |
| Capture succeeds but response is lost and retried | Same logical capture returned; no duplicate task under the agreed retry contract |
| Destination missing, read-only, sidecar, or otherwise unsupported | No source changes; clear structured error |
| Source revision stale | Conflict, with source and destination unchanged |
| Destination collision | No overwrite; explicit conflict |
| Interruption between destination persistence and source removal | Durable recoverable transfer state; do not declare success while duplicate authoritative files are unresolved |
| Pending edit queued against old project during filing | Revalidate ownership and coordinate queues before mutation; no write outside destination protection |
| Existing title/path links or relative assets | Preserve defined supported references or refuse unsupported transfer; never silently promise portability |
| Restart/full reindex after completed filing | Exactly one record with original ID and creation time, correct project/task state, and defined link behaviour |

These are proposed implementation requirements, not passed tests. Exact recovery and reference-handling design still needs to be made reviewable before implementation.
