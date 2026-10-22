import {
  COMMENTS_SEGMENT,
  TICKETS_SEGMENT,
  type DeleteDocumentAck,
  type DeleteProjectAck,
  type DocumentSummary,
  type RecoveryKind,
  type RecoveryPath,
  type RecoveryReason,
} from '@backlogger/shared';
import { ConflictError } from '../errors.js';
import {
  DocumentNotFoundError,
  FsRepoError,
  type FsRepository,
  type SidecarStore,
} from '../fs/index.js';
import { parseCommentFile } from '../fs/comment-file.js';
import type { CommentsRepo } from '../db/comments-repo.js';
import type { DocumentsRepo } from '../db/documents-repo.js';
import type { ProjectsRepo } from '../db/projects-repo.js';
import {
  DELETE_DOCUMENT_COMMAND,
  DELETE_PROJECT_COMMAND,
  type ManifestEntry,
} from '../db/operations-repo.js';
import type { LinkService } from './link-service.js';
import type {
  CompleteRecovered,
  IntentRecord,
  PendingOperation,
  RecoveryAssessment,
  Recoverer,
  WriteCoordinator,
} from './write-coordinator.js';

export { DELETE_DOCUMENT_COMMAND, DELETE_PROJECT_COMMAND };

export interface PermanentDeletionDeps {
  coordinator: WriteCoordinator;
  documentsRepo: DocumentsRepo;
  commentsRepo: CommentsRepo;
  projectsRepo: ProjectsRepo;
  linkService: LinkService;
  sidecarStore: SidecarStore;
  fs: FsRepository;
}

type DeletionCommand = typeof DELETE_DOCUMENT_COMMAND | typeof DELETE_PROJECT_COMMAND;

/** What a pending deletion keeps besides its inventory (no content). */
interface DeletionPayload {
  project_id: string;
  /** The deleted document; `null` for a project deletion. */
  document_id: string | null;
  /** The document's own file, removed after its comments. */
  document_path: string | null;
  /** The document's sidecar entry, when it had one instead of frontmatter. */
  sidecar_key: string | null;
  /** Folders whose every entry must be in the inventory. */
  scopes: string[];
}

/** A deletion, read back from its payload and inventory. */
export interface DeletionPlan {
  operationId: string;
  command: DeletionCommand;
  projectId: string;
  documentId: string | null;
  documentPath: string | null;
  sidecarKey: string | null;
  scopes: string[];
  /** Files to remove, with the revision each must still have. */
  files: Array<{ path: string; revision: string }>;
  /** Folders removed once empty. */
  dirs: string[];
}

/** Why a deletion cannot go on from where it stands. */
interface Stop {
  kind: Exclude<RecoveryKind, 'resumable'>;
  reason: RecoveryReason;
  message: string;
}

/** Where everything a deletion covers stands now. */
interface Observation {
  /** Inventory path → revision of its bytes now; `null` when absent. */
  revisions: Map<string, string | null>;
  /** Entries inside the scope the inventory does not list, with their revision if a file. */
  unexpected: Array<{ path: string; revision: string | null }>;
}

export type DeletionResult<A> = { done: true; ack: A } | { done: false; stop: Stop };

/** Observed in place of a revision for an inventory path that is no longer a plain file. */
const NOT_A_FILE = 'not-a-file';

/** `<project>/tickets/<task>`, the folder holding a task's comment folder. */
export function ticketDir(projectId: string, taskId: string): string {
  return `${projectId}/${TICKETS_SEGMENT}/${taskId}`;
}

/**
 * Resumable permanent deletion (spec #58, "Permanent deletion").
 *
 *  1. Prepare: inventory every path in scope with its revision (no content):
 *     a document, its comment files and their folders, or a whole project
 *     folder. Anything the deletion must not judge on its own (an unknown or
 *     malformed file in a comment folder, any symlink) refuses it, unchanged.
 *  2. The intent transaction records the inventory and the guards; from then
 *     on the items are hidden from boards, lists and search
 *     (`pendingDeletionCovers`) and the operation is listed for recovery.
 *  3. Remove only files that still match: a missing one is done, a changed
 *     one, or anything new in scope, stops the deletion with everything left
 *     kept. A document's own file goes last, after its comments.
 *  4. Remove folders only once empty, deepest first; never recursively and
 *     never through a symlink.
 *  5. Complete: derived rows, receipt and guard release in one transaction.
 *
 * Recovery runs the same steps from wherever the files stand. There is no
 * rollback, no abandon and no record of deleted IDs beyond the receipt.
 */
export class PermanentDeletion implements Recoverer {
  readonly abandonable = false;
  private readonly coordinator: WriteCoordinator;
  private readonly documentsRepo: DocumentsRepo;
  private readonly commentsRepo: CommentsRepo;
  private readonly projectsRepo: ProjectsRepo;
  private readonly linkService: LinkService;
  private readonly sidecarStore: SidecarStore;
  private readonly fs: FsRepository;

  constructor(deps: PermanentDeletionDeps) {
    this.coordinator = deps.coordinator;
    this.documentsRepo = deps.documentsRepo;
    this.commentsRepo = deps.commentsRepo;
    this.projectsRepo = deps.projectsRepo;
    this.linkService = deps.linkService;
    this.sidecarStore = deps.sidecarStore;
    this.fs = deps.fs;
  }

  /**
   * Step 1 for a document (with its comments, for a backlog item). Refuses,
   * changing nothing, when its comment folder holds anything but its
   * comments. `sidecarKey` names its sidecar entry, if it has one.
   */
  async prepareDocument(
    operationId: string,
    summary: DocumentSummary,
    sidecarKey: string | null,
  ): Promise<{ plan: DeletionPlan; intent: IntentRecord }> {
    const projectId = summary.project_id;
    const taskId = summary.id;
    const scope = ticketDir(projectId, taskId);
    const comments = `${scope}/${COMMENTS_SEGMENT}`;
    const files: DeletionPlan['files'] = [];
    const problems: string[] = [];
    for (const entry of await this.fs.listTree(scope)) {
      if (entry.kind === 'directory' && entry.path === comments) continue;
      if (entry.kind !== 'file' || !entry.path.startsWith(`${comments}/`)) {
        problems.push(entry.path);
        continue;
      }
      const text = await this.fs.readExactText(entry.path).catch((err: unknown) => {
        if (err instanceof FsRepoError && !(err instanceof DocumentNotFoundError)) return null;
        throw err;
      });
      const parsed = text === null ? null : parseCommentFile(entry.path, text);
      if (!parsed?.ok || parsed.comment.parent_id !== taskId) {
        problems.push(entry.path);
        continue;
      }
      files.push({ path: entry.path, revision: (await this.fs.fileRevision(entry.path))! });
    }
    if (problems.length > 0) {
      throw deletionBlocked(
        `The task's comment folder holds files that are not its comments; move or repair them first: ${problems.join(', ')}`,
        problems,
      );
    }
    // A file already gone (an interrupted older delete) is simply not listed.
    const documentRevision = await this.fs.fileRevision(summary.path);
    if (documentRevision !== null) files.push({ path: summary.path, revision: documentRevision });

    const plan: DeletionPlan = {
      operationId,
      command: DELETE_DOCUMENT_COMMAND,
      projectId,
      documentId: taskId,
      documentPath: summary.path,
      sidecarKey,
      scopes: [scope],
      files,
      dirs: [comments, scope],
    };
    return {
      plan,
      intent: this.intentOf(plan, [
        { project_id: projectId, scope: 'task', key: taskId },
        { project_id: projectId, scope: 'path', key: summary.path },
        { project_id: projectId, scope: 'path', key: scope },
      ]),
    };
  }

  /**
   * Step 1 for a whole project folder: every file and folder in it. Refuses,
   * changing nothing, when the folder is a symlink or holds one.
   */
  async prepareProject(
    operationId: string,
    projectId: string,
  ): Promise<{ plan: DeletionPlan; intent: IntentRecord }> {
    if (await this.fs.isProjectSymlink(projectId)) {
      throw deletionBlocked(
        `The project folder ${projectId} is a symlink; Backlogger never deletes through one. Remove the link by hand.`,
        [projectId],
      );
    }
    const files: DeletionPlan['files'] = [];
    const dirs: string[] = [projectId];
    const problems: string[] = [];
    for (const entry of await this.fs.listTree(projectId)) {
      if (entry.kind === 'directory') dirs.push(entry.path);
      else if (entry.kind === 'file') {
        files.push({ path: entry.path, revision: (await this.fs.fileRevision(entry.path))! });
      } else problems.push(entry.path);
    }
    if (problems.length > 0) {
      throw deletionBlocked(
        `The project folder holds symlinks or special files Backlogger never follows or deletes; remove them first: ${problems.join(', ')}`,
        problems,
      );
    }
    const plan: DeletionPlan = {
      operationId,
      command: DELETE_PROJECT_COMMAND,
      projectId,
      documentId: null,
      documentPath: null,
      sidecarKey: null,
      scopes: [projectId],
      files,
      dirs,
    };
    return {
      plan,
      intent: this.intentOf(plan, [{ project_id: projectId, scope: 'project', key: projectId }]),
    };
  }

  /**
   * Steps 3–5 with the deletion's locks held. Returns the acknowledgement
   * once complete, or where it stopped, everything left kept.
   */
  async advance(
    plan: DeletionPlan,
    complete: CompleteRecovered,
  ): Promise<DeletionResult<DeleteDocumentAck | DeleteProjectAck>> {
    let stop = this.judge(plan, await this.observe(plan));
    if (stop) return { done: false, stop };

    for (const file of removalOrder(plan)) {
      let result;
      try {
        result = await this.fs.deleteIfUnchanged(file.path, file.revision);
      } catch (err) {
        if (err instanceof FsRepoError) return { done: false, stop: notAFile(file.path) };
        throw err;
      }
      if (result === 'changed') return { done: false, stop: changed(file.path) };
    }
    if (plan.sidecarKey !== null) await this.sidecarStore.delete(plan.projectId, plan.sidecarKey);
    for (const dir of [...plan.dirs].sort(deepestFirst)) await this.fs.removeEmptyDir(dir);

    stop = this.judge(plan, await this.observe(plan));
    if (stop) return { done: false, stop };
    const ack = acknowledgement(plan);
    complete(ack, () => this.removeDerived(plan));
    return { done: true, ack };
  }

  async assess(op: PendingOperation): Promise<RecoveryAssessment> {
    const plan = this.planOf(op);
    if (!plan) {
      return {
        kind: 'structural',
        reason: 'ambiguous_path',
        message: 'The deletion does not name what it covers; repair by hand.',
        project_id: null,
        task_id: null,
        comment_id: null,
        paths: [],
        pending_content: null,
        current_content: null,
      };
    }
    const seen = await this.observe(plan);
    const what = plan.documentId === null ? `project ${plan.projectId}` : 'the item';
    return {
      ...(this.judge(plan, seen) ?? {
        kind: 'resumable',
        reason: 'interrupted',
        message: `Deleting ${what} was interrupted; Recheck finishes it.`,
      }),
      project_id: plan.projectId,
      task_id: plan.documentId,
      comment_id: null,
      paths: [
        ...plan.files.map(
          (f): RecoveryPath => ({
            path: f.path,
            before_revision: f.revision,
            after_revision: null,
            observed_revision: seen.revisions.get(f.path) ?? null,
          }),
        ),
        ...seen.unexpected.map(
          (u): RecoveryPath => ({
            path: u.path,
            before_revision: null,
            after_revision: null,
            observed_revision: u.revision,
          }),
        ),
      ],
      pending_content: null,
      current_content: null,
    };
  }

  async resume(op: PendingOperation, complete: CompleteRecovered): Promise<void> {
    const plan = this.planOf(op);
    if (plan) await this.advance(plan, complete);
  }

  private intentOf(plan: DeletionPlan, guards: IntentRecord['guards']): IntentRecord {
    const payload: DeletionPayload = {
      project_id: plan.projectId,
      document_id: plan.documentId,
      document_path: plan.documentPath,
      sidecar_key: plan.sidecarKey,
      scopes: plan.scopes,
    };
    return {
      guards,
      payload: JSON.stringify(payload),
      manifest: [
        ...plan.files.map(
          (f): ManifestEntry => ({ path: f.path, role: 'file', fingerprint: f.revision }),
        ),
        ...plan.dirs.map((d): ManifestEntry => ({ path: d, role: 'dir', fingerprint: null })),
      ],
    };
  }

  /** The deletion a pending operation records, or `undefined` when unreadable. */
  private planOf(op: PendingOperation): DeletionPlan | undefined {
    if (op.command !== DELETE_DOCUMENT_COMMAND && op.command !== DELETE_PROJECT_COMMAND) {
      return undefined;
    }
    let payload: Partial<DeletionPayload>;
    try {
      payload = JSON.parse(op.payload ?? '') as Partial<DeletionPayload>;
    } catch {
      return undefined;
    }
    const { project_id: projectId, document_id: documentId = null, scopes } = payload;
    if (typeof projectId !== 'string' || !Array.isArray(scopes) || scopes.length === 0) {
      return undefined;
    }
    if ((op.command === DELETE_DOCUMENT_COMMAND) !== (typeof documentId === 'string')) {
      return undefined;
    }
    const inProject = (p: unknown): p is string =>
      typeof p === 'string' && (p === projectId || p.startsWith(`${projectId}/`));
    if (!scopes.every(inProject)) return undefined;

    const files: DeletionPlan['files'] = [];
    const dirs: string[] = [];
    for (const e of this.coordinator.manifestOf(op.operation_id)) {
      if (!inProject(e.path)) return undefined;
      if (e.role === 'file' && e.fingerprint !== null)
        files.push({ path: e.path, revision: e.fingerprint });
      else if (e.role === 'dir') dirs.push(e.path);
      else return undefined;
    }
    return {
      operationId: op.operation_id,
      command: op.command,
      projectId,
      documentId,
      documentPath: payload.document_path ?? null,
      sidecarKey: payload.sidecar_key ?? null,
      scopes,
      files,
      dirs,
    };
  }

  private async observe(plan: DeletionPlan): Promise<Observation> {
    const revisions = new Map<string, string | null>();
    for (const f of plan.files) revisions.set(f.path, await this.revisionOf(f.path));
    const listedDirs = new Set(plan.dirs);
    const unexpected: Observation['unexpected'] = [];
    if (plan.documentId === null && (await this.fs.isProjectSymlink(plan.projectId))) {
      unexpected.push({ path: plan.projectId, revision: null });
      return { revisions, unexpected };
    }
    for (const scope of plan.scopes) {
      for (const entry of await this.fs.listTree(scope)) {
        if (entry.kind === 'directory' && listedDirs.has(entry.path)) continue;
        if (entry.kind === 'file' && revisions.has(entry.path)) continue;
        unexpected.push({
          path: entry.path,
          revision: entry.kind === 'file' ? await this.revisionOf(entry.path) : null,
        });
      }
    }
    return { revisions, unexpected };
  }

  /** Whether the deletion can go on: nothing new in scope, every listed file unchanged or gone. */
  private judge(plan: DeletionPlan, seen: Observation): Stop | null {
    const [first] = seen.unexpected;
    if (first !== undefined) {
      return {
        kind: 'structural',
        reason: 'unexpected_file',
        message: `${first.path} is not part of this deletion and is kept; move it out, then Recheck.`,
      };
    }
    for (const f of plan.files) {
      const now = seen.revisions.get(f.path) ?? null;
      if (now === NOT_A_FILE) return notAFile(f.path);
      if (now !== null && now !== f.revision) return changed(f.path);
    }
    return null;
  }

  /** Step 5's index writes: every derived row of what was deleted. */
  private removeDerived(plan: DeletionPlan): void {
    if (plan.documentId !== null) {
      this.documentsRepo.delete(plan.documentId);
      this.linkService.onDocumentDeleted(plan.documentId);
      this.commentsRepo.deleteByTask(plan.documentId);
      return;
    }
    for (const doc of this.documentsRepo.listIndexedByProject(plan.projectId)) {
      this.documentsRepo.delete(doc.id);
      this.linkService.onDocumentDeleted(doc.id);
    }
    this.commentsRepo.deleteByProject(plan.projectId);
    this.projectsRepo.delete(plan.projectId);
  }

  private async revisionOf(relPath: string): Promise<string | null> {
    try {
      return await this.fs.fileRevision(relPath);
    } catch (err) {
      // A symlink or a folder where a listed file was: never followed.
      if (err instanceof FsRepoError || (err as NodeJS.ErrnoException).code === 'EISDIR') {
        return NOT_A_FILE;
      }
      throw err;
    }
  }
}

/** Files in removal order: a document's own file last, after its comments. */
function removalOrder(plan: DeletionPlan): DeletionPlan['files'] {
  const last = plan.files.filter((f) => f.path === plan.documentPath);
  return [...plan.files.filter((f) => f.path !== plan.documentPath), ...last];
}

function deepestFirst(a: string, b: string): number {
  return b.split('/').length - a.split('/').length || (a < b ? -1 : a > b ? 1 : 0);
}

function acknowledgement(plan: DeletionPlan): DeleteDocumentAck | DeleteProjectAck {
  if (plan.documentId === null) {
    return {
      operation_id: plan.operationId,
      command: DELETE_PROJECT_COMMAND,
      project_id: plan.projectId,
      outcome: 'deleted',
    };
  }
  return {
    operation_id: plan.operationId,
    command: DELETE_DOCUMENT_COMMAND,
    document_id: plan.documentId,
    project_id: plan.projectId,
    outcome: 'deleted',
    result_revision: null,
  };
}

function deletionBlocked(message: string, paths: string[]): ConflictError {
  return new ConflictError('DELETION_BLOCKED', message, { paths });
}

function changed(relPath: string): Stop {
  return {
    kind: 'content_conflict',
    reason: 'content_changed',
    message: `${relPath} changed after the deletion started; it is kept as it is.`,
  };
}

function notAFile(relPath: string): Stop {
  return {
    kind: 'structural',
    reason: 'unexpected_file',
    message: `${relPath} is no longer a plain file; it is never followed or deleted. Repair it, then Recheck.`,
  };
}
