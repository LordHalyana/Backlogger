# Research resolution: overlapping saves and minimum write guarantees

Issue: [Backlogger #4](https://github.com/LordHalyana/Backlogger/issues/4)  
Inspected revision: `b7147426ec4f6c7f8b42bd85688480d70e1568af`  
Research date: 2026-10-16  
Status: question answered; prerequisite repairs recommended, not implemented.

## Answer

**Yes. Controlled experiments against the real API and persistence modules reproduce both same-document lost updates and different-document sidecar metadata loss.** Atomic replacement prevents a reader seeing a partly written replacement; it does not make a read–modify–write operation exclusive. Board mutations should wait for serialized mutations, revision checks inside the serialization boundary, and sidecar transaction coordination.

These experiments establish reachable interleavings, not their frequency in everyday usage. They use temporary data, in-memory SQLite with the real migrations, real Express routes, real document services, and actual filesystem writes. The only injected behavior is a barrier after two real reads, ensuring both concurrent operations have observed the same starting state. There are no fake metadata values, fake persistence methods, or production code edits. Browser UI, watcher concurrency, power loss and multi-process access were not exercised.

## Reproduction evidence

Environment: Node `v24.19.0`; repository lockfile dependencies installed using `npm ci --ignore-scripts --no-audit --no-fund`, then `npm rebuild better-sqlite3` to enable the real SQLite implementation. No tracked files changed (`git status --short` empty after run).

Portable harness: Appendix A (save as `reproduce-write-safety.mts` at the repository root).  
Captured portable-run output: Appendix B.  
Working directory: a checkout of the inspected repository revision.

```bash
node --conditions=tsx --import tsx reproduce-write-safety.mts
```

The initial invocation without `--conditions=tsx` failed before any experiment because the unbuilt shared package's default export points to `dist/index.js`. The successful invocation selects its source export; it does not require altering the repository.

| Experiment | Mechanism | Observed result |
|---|---|---|
| Same document, equal original `If-Match`, disjoint changes | Hold both actual `FsRepository.read` returns until both reads complete; concurrently PUT a changed title and changed body | Both HTTP responses were 200. Final document had `Changed title` and original body. Accepted body change was lost. |
| Two different documents in a sidecar project | Hold both actual `SidecarStore.load` returns until both loads complete; PUT a new title for each document using its own matching revision | Both responses were 200; SQLite initially reported both new titles. Persisted sidecar contained `A original` and `B changed`: A's accepted metadata update was lost. |
| Reindex after sidecar collision | Invoke actual `runProject('sidecar')` | SQLite then reported `A original` and `B changed`. Reindex faithfully propagated the lost persisted metadata; it did not recover it. |

The winning operation is scheduling-dependent. The invariant demonstrated is that both saves report success while one accepted change disappears, not that a specific request always wins.

The portable harness creates a unique disposable directory under the operating system temporary directory and prints its location. It retains that directory for inspection. No personal mounted directories were accessed. The portable version was executed successfully; its output is reproduced in Appendix B.

## Source findings

### 1. The existing optimistic check is outside the critical section

`update` fetches the SQLite summary and compares optional `ifMatch` with `summary.updated_at` before its first awaited read. Two overlapping requests can both pass, then independently construct replacements. Native updates write the file before upserting SQLite. [DocumentService lines 192–273](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L192-L273)

The route accepts a missing `If-Match`; the existing editor supplies one. Thus server-side serialization alone would still permit an unconditional stale client payload unless the API also defines mandatory revision preconditions for user edits. [Route lines 87–95](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/routes/documents.ts#L87-L95), [client lines 61–81](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/web/src/lib/documents.ts#L61-L81)

`updated_at` defaults to a millisecond-resolution ISO timestamp, not a distinct revision identifier. Same-millisecond updates and external edits that leave frontmatter timestamps untouched are inspected risks, not reproduced here. The current comparison uses the indexed timestamp rather than verifying a fingerprint of current disk content. [Clock default](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L52-L62), [comparison/read ordering](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L197-L209)

### 2. A shared sidecar needs a project-level mutation boundary

Each `set`, `rename`, or `delete` loads the whole index, changes an in-memory copy, then replaces the whole index. There is no shared mutation queue. A per-document lock would not repair different-document collisions. [SidecarStore lines 75–101](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/fs/sidecar-store.ts#L75-L101)

Sidecar document updates replace the Markdown body, then update the sidecar, then SQLite. These are separate operations; failure between them can leave mixed versions. Creation likewise writes body and metadata before the guarded SQLite operation. [Update lines 280–319](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L280-L319), [create lines 150–182](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/document-service.ts#L150-L182)

Corrupt sidecar JSON/schema is treated as an empty index; a later mutation can replace that file using the empty interpretation. Recommend distinguishing a genuinely missing file from corrupt metadata for writes, preserving corrupt originals and refusing silent destructive replacement. This failure mode was inspected, not tested. [Load lines 34–48](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/fs/sidecar-store.ts#L34-L48)

### 3. Atomic single-file replacement already exists

The repository and sidecar writer use unique same-directory temporary files, write, file sync, close, and rename. Retain these mechanisms. They do not encompass the body-plus-sidecar-plus-index sequence, and the implementation does not sync the containing directory after rename. No power-loss durability claim is established by this review. [Filesystem writes lines 192–251](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/fs/repository.ts#L192-L251), [sidecar writes lines 51–73](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/fs/sidecar-store.ts#L51-L73)

### 4. Autosave needs to preserve edits made while a save is pending

The hook debounces for 800 ms and starts mutations without checking an in-flight save. When a new server timestamp arrives it replaces the whole local buffer and clears dirty state. A save response arriving after additional typing can therefore reset newer unsaved input. This is a source-inspected UI risk, not a browser-reproduced failure. [Buffer initialization and flush lines 65–115](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/web/src/hooks/useDocumentBuffer.ts#L65-L115)

Recommend one in-flight save per open document, a local edit generation counter, and retention of newer dirty edits when an older save response arrives. Conflicts should preserve the user's draft for explicit reconciliation rather than blindly retrying the full stale payload.

### 5. Watcher/reindex coordination is separate from debounce

The watcher reacts to Markdown changes and debounces reindex by 800 ms; it ignores the hidden `.backlogger` directory. `runProject` excludes another run of itself for the same project, but does not share that exclusion with mutations. It loads one sidecar snapshot before iterating files. These observations establish an uncoordinated boundary, not a reproduced watcher overwrite. [Watcher lines 23–65](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/fs/project-watcher.ts#L23-L65), [reindex lines 127–188](https://github.com/LordHalyana/Backlogger/blob/b7147426ec4f6c7f8b42bd85688480d70e1568af/packages/api/src/services/reindex-service.ts#L127-L188)

A debounce is not a lock. External writers also cannot be controlled by an application-local queue. Document supported editing modes and detect changed disk content; do not claim filesystem compare-and-swap against arbitrary external writers.

## Narrow repair strategy

For this single-process, local-first application, **one per-project operation queue shared by create/update/move/delete and project reindex is the simplest initial coordination strategy**. It includes the per-document guarantee and the shared-sidecar guarantee without a complex lock hierarchy. Multiple projects can still operate independently. If measured contention later warrants finer granularity, use per-document serialization plus a project-sidecar read–modify–write lock with an explicit acquisition order. An in-process queue does not protect two server processes using one data directory; initially declare and enforce one server owner.

Inside the queue, load current state, check permissions and the caller's revision, derive the next state, persist, then update the index. Revision tokens must change for every successful mutation. Prefer an opaque revision/fingerprint covering the full editable record rather than wall-clock time alone; retain `updated_at` for display. Define external-edit detection deliberately, since a UUID token stored in frontmatter alone will not change when an external editor edits only the body.

Before promising crash recovery for sidecar edits, define the smallest recoverable multi-file commit protocol: a durable intent record with enough state to complete or roll back body+sidecar, deterministic startup handling before reindex, and surfaced failures. Alternatively, explicitly narrow the first milestone's crash guarantee to atomic single-file native documents and defer transactional sidecar editing. That is a product/support decision; do not advertise complete crash safety based only on temp+rename.

## Proposed prerequisite implementation issues (not created)

1. **Preserve concurrent edits and shared-sidecar mutations.** Shared operation coordination, revision validation inside the boundary, distinct revisions, and documented missing-precondition behaviour. Include update/move/delete interactions and project reindex. Acceptance: same-base concurrent edits yield one accepted write and one conflict; disjoint sidecar edits both persist and survive reindex.
2. **Preserve newer editor input during delayed autosave.** One active save with queued later edits, generation-aware acknowledgement and conflict preservation. Acceptance: type A, delay its response, type B; B remains in the editor and eventually persists, or remains visibly unsaved on conflict/error.
3. **Recover interrupted sidecar edits without silent metadata replacement.** Fail safely on corrupt sidecars, define/test the body+metadata commit boundary, and recover before indexing. Acceptance: injected failure after each persistence step leaves either a consistent old/new record or an explicit recoverable state; unrelated metadata is retained.

The first two are justified prerequisites for adding high-frequency board mutations. The third is required before making a strong crash-recovery claim for editable sidecar-backed tasks; its exact scope must be agreed.

## Failure scenarios for the implementation work

- Two requests with the same revision update disjoint fields: one conflicts; no accepted change disappears silently.
- Two documents in one sidecar project update concurrently: both entries survive reload and reindex.
- Update overlaps archive/move/delete: no duplicate path, resurrected document, or orphaned metadata.
- Project reindex overlaps a save: final SQLite view matches committed files; no stale snapshot is committed last.
- Same-clock-tick writes receive distinguishable revisions.
- External body edit with unchanged frontmatter is detected before overwriting where supported; uncontrolled races are explicitly outside the guarantee.
- Autosave response after further typing preserves the newer dirty buffer.
- Corrupt sidecar is preserved and reported, not replaced as an empty store.
- Process interruption after each body/sidecar/index step is recovered deterministically if transactional sidecar writes are promised.

No schema/product choices have been silently resolved, no production fixes implemented, and no GitHub mutations performed by this research worker.

## Appendix A: complete portable reproduction harness

Save the following as `reproduce-write-safety.mts` in the repository root. Use the pinned revision above and install its lockfile dependencies as described earlier. Run from the repository root with `node --conditions=tsx --import tsx reproduce-write-safety.mts`. This harness uses no production data directory and does not alter production source files. It retains generated temporary data for inspection; remove only the printed temporary directory when finished.

```typescript
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createApp } from './packages/api/src/app.ts';
import { buildContext } from './packages/api/src/context.ts';
import { openDatabase } from './packages/api/src/db/database.ts';
const repo = path.dirname(fileURLToPath(import.meta.url));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-write-safety-'));
const db = openDatabase({file: ':memory:', migrationsDir:path.join(repo,'migrations')});
const ctx = buildContext({db,dataDir:root});
const app = createApp(ctx);
// Barriers delay actual method return until both reads complete; no fake records or writes.
function barrierAfterTwoReads(object:any, name:string) {
 const original = object[name].bind(object); let count=0; let release:any;
 const gate = new Promise<void>(r=>release=r);
 object[name] = async (...args:any[]) => { const result=await original(...args); count++; if(count===2) release(); await gate; return result; };
 return ()=>object[name]=original;
}
try {
 await ctx.projectService.create({id:'native',name:'Native'});
 let doc=await ctx.documentService.create('native',{title:'Original',type:'backlog_item',body:'Original body'});
 let restore=barrierAfterTwoReads(ctx.fs,'read');
 const both=await Promise.all([
 request(app).put(`/api/documents/${doc.id}`).set('If-Match',doc.updated_at).send({title:'Changed title'}),
 request(app).put(`/api/documents/${doc.id}`).set('If-Match',doc.updated_at).send({body:'Changed body'})
 ]);
 restore();
 const final=await ctx.documentService.get(doc.id);
 console.log(JSON.stringify({scenario:'same_document_same_revision',statuses:both.map(x=>x.status),returned:both.map(x=>({title:x.body.title,body:x.body.body})),persisted:{title:final.title,body:final.body},lostAcceptedChange:final.title!=='Changed title'||final.body.trim()!=='Changed body'}));
 await ctx.projectService.create({id:'sidecar',name:'Sidecar'});
 ctx.projectService.update('sidecar',{metadataMode:'sidecar'});
 const a=await ctx.documentService.create('sidecar',{title:'A original',type:'backlog_item',body:'A'});
 const b=await ctx.documentService.create('sidecar',{title:'B original',type:'backlog_item',body:'B'});
 restore=barrierAfterTwoReads(ctx.sidecarStore,'load');
 const updates=await Promise.all([
 request(app).put(`/api/documents/${a.id}`).set('If-Match',a.updated_at).send({title:'A changed'}),
 request(app).put(`/api/documents/${b.id}`).set('If-Match',b.updated_at).send({title:'B changed'})
 ]);
 restore();
 const sidecar=await ctx.sidecarStore.load('sidecar');
 const persistedTitles=Object.values(sidecar.entries).map((x:any)=>x.title);
 console.log(JSON.stringify({scenario:'different_documents_shared_sidecar',statuses:updates.map(x=>x.status),databaseTitles:ctx.documentsRepo.listByProject('sidecar').map(x=>x.title),persistedTitles,lostAcceptedChange:!persistedTitles.includes('A changed')||!persistedTitles.includes('B changed')}));
 await ctx.reindexService.runProject('sidecar');
 console.log(JSON.stringify({scenario:'after_reindex',databaseTitles:ctx.documentsRepo.listByProject('sidecar').map(x=>x.title)}));
 console.log(JSON.stringify({disposableData:root}));
} finally { db.close(); }
```

## Appendix B: output of the validated portable harness

```jsonl
{"scenario":"same_document_same_revision","statuses":[200,200],"returned":[{"title":"Changed title","body":"Original body\n"},{"title":"Original","body":"Changed body"}],"persisted":{"title":"Changed title","body":"Original body\n"},"lostAcceptedChange":true}
{"scenario":"different_documents_shared_sidecar","statuses":[200,200],"databaseTitles":["A changed","B changed"],"persistedTitles":["A original","B changed"],"lostAcceptedChange":true}
{"scenario":"after_reindex","databaseTitles":["A original","B changed"]}
{"disposableData":"/tmp/backlogger-write-safety-ZZ5udB"}
```
