import matter from 'gray-matter';
import { v4 as uuidv4 } from 'uuid';
import {
  archivePath,
  CreateDocumentRequestSchema,
  DOCUMENT_TYPE_TO_SUBDIR,
  FrontmatterSchema,
  isArchivedFolder,
  isArchivedPath,
  storedTaskState,
  unarchivePath,
  type CaptureRequest,
  type CreateDocumentRequest,
  type Document,
  type DocumentSummary,
  type Frontmatter,
  type SidecarEntry,
  type UpdateDocumentRequest,
} from '@backlogger/shared';
import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';
import {
  sidecarRevision,
  type FsRepository,
  type RawDocument,
  type SidecarStore,
} from '../fs/index.js';
import type { DocumentsRepo } from '../db/documents-repo.js';
import type { LinkService } from './link-service.js';
import type { TagsService } from './tags-service.js';
import type { GraphService } from './graph-service.js';
import type { ProjectRecord, ProjectsRepo } from '../db/projects-repo.js';
import { applyPlaceholders, type TemplateRegistry } from '../templates/registry.js';
import type { ProjectQueue } from './project-queue.js';
import type { InboxService } from './inbox-service.js';

export interface DocumentServiceDeps {
  documentsRepo: DocumentsRepo;
  projectsRepo: ProjectsRepo;
  fs: FsRepository;
  templates: TemplateRegistry;
  linkService: LinkService;
  tagsService: TagsService;
  graphService: GraphService;
  sidecarStore: SidecarStore;
  /** Per-project mutation queue, shared with the reindex service. */
  queue: ProjectQueue;
  inbox: InboxService;
  now?: () => string;
  newId?: () => string;
}

/** An imported file's `task_state`, written verbatim (recognised or not). */
export interface ImportedTaskState {
  /** `undefined` when the imported file has none. */
  value: unknown;
}

/** Internal create options (not exposed over HTTP). */
export interface CreateOptions {
  /** Replaces the request's task state; an absent value stays absent. */
  importedTaskState?: ImportedTaskState;
  /** A client-chosen id (capture) instead of a generated one. */
  id?: string;
}

/** The outcome of a capture: the item, and whether this request created it. */
export interface CaptureResult {
  document: Document;
  created: boolean;
}

/** Internal update options (not exposed over HTTP). */
export interface UpdateOptions {
  /** Overwrites the stored task state when its value is defined. */
  importedTaskState?: ImportedTaskState;
}

export class DocumentService {
  private readonly documentsRepo: DocumentsRepo;
  private readonly projectsRepo: ProjectsRepo;
  private readonly fs: FsRepository;
  private readonly templates: TemplateRegistry;
  private readonly linkService: LinkService;
  private readonly tagsService: TagsService;
  private readonly graphService: GraphService;
  private readonly sidecarStore: SidecarStore;
  private readonly queue: ProjectQueue;
  private readonly inbox: InboxService;
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(deps: DocumentServiceDeps) {
    this.documentsRepo = deps.documentsRepo;
    this.projectsRepo = deps.projectsRepo;
    this.fs = deps.fs;
    this.templates = deps.templates;
    this.linkService = deps.linkService;
    this.tagsService = deps.tagsService;
    this.graphService = deps.graphService;
    this.sidecarStore = deps.sidecarStore;
    this.queue = deps.queue;
    this.inbox = deps.inbox;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.newId = deps.newId ?? (() => uuidv4());
  }

  listByProject(projectId: string): DocumentSummary[] {
    const project = this.getProject(projectId);
    return this.applyProjectReadOnly(project, this.documentsRepo.listByProject(projectId));
  }

  listByProjectAndTags(projectId: string, tags: string[]): DocumentSummary[] {
    const project = this.getProject(projectId);
    return this.applyProjectReadOnly(
      project,
      this.documentsRepo.listByProjectAndTags(projectId, tags),
    );
  }

  /** Full document including body, read fresh from disk. */
  async get(id: string): Promise<Document> {
    const summary = this.documentsRepo.find(id);
    if (!summary) throw new NotFoundError('DOCUMENT_NOT_FOUND', `Document not found: ${id}`);
    const raw = await this.fs.read(summary.path);
    const project = this.getProject(summary.project_id);
    const revision = await this.currentRevision(summary, raw);
    return { ...summary, readOnly: project.readOnly, revision, body: raw.body };
  }

  /**
   * Locate the on-disk Markdown file for a document so callers (e.g. the
   * `/api/documents/:id/raw` export route) can stream it without
   * round-tripping through `gray-matter`. Throws `NotFoundError` if either
   * the row or the file is missing.
   */
  async locateRaw(id: string): Promise<{
    absolutePath: string;
    /** Filename on disk (already `<slug>-<short8>.md`, safe for `Content-Disposition`). */
    diskFilename: string;
    /** Human-readable title — use in the `filename*` RFC 5987 extension. */
    title: string;
  }> {
    const summary = this.documentsRepo.find(id);
    if (!summary) throw new NotFoundError('DOCUMENT_NOT_FOUND', `Document not found: ${id}`);
    const absolutePath = await this.fs.resolveAbsolutePath(summary.path);
    const diskFilename = summary.path.split('/').pop() ?? `${id}.md`;
    return { absolutePath, diskFilename, title: summary.title };
  }

  async create(
    projectId: string,
    input: CreateDocumentRequest,
    options: CreateOptions = {},
  ): Promise<Document> {
    this.getProject(projectId);
    return this.queue.run(projectId, () => this.createInQueue(projectId, input, options));
  }

  private async createInQueue(
    projectId: string,
    input: CreateDocumentRequest,
    options: CreateOptions,
  ): Promise<Document> {
    const project = this.assertProjectWritable(projectId);
    // Re-validate to apply defaults from the schema (status, tags).
    const parsed = CreateDocumentRequestSchema.parse(input);
    if (parsed.task_state !== undefined && parsed.type !== 'backlog_item') {
      throw taskStateNotAllowed(parsed.type);
    }
    if (parsed.task_state !== undefined && project.metadataMode === 'sidecar') {
      throw taskStateNotAllowed('sidecar-backed document');
    }
    // New backlog items are written with an explicit task state (`todo`
    // unless asked otherwise); other types never get one.
    const taskState =
      parsed.type !== 'backlog_item' || project.metadataMode === 'sidecar'
        ? undefined
        : options.importedTaskState
          ? options.importedTaskState.value
          : (parsed.task_state ?? 'todo');

    const id = options.id ?? this.newId();
    const now = this.now();
    // Folder placement: explicit `folder` wins, otherwise fall back to the
    // legacy type → subdir map so callers that don't supply a folder keep
    // the original behaviour.
    const subdir = parsed.folder ?? DOCUMENT_TYPE_TO_SUBDIR[parsed.type];
    const filename = buildFilename(parsed.title, id);
    const relPath = `${projectId}/${subdir}/${filename}`;

    let body = parsed.body ?? '';
    if (parsed.template) {
      const tpl = this.templates.getOrThrow(parsed.template);
      if (!tpl) {
        throw new NotFoundError(
          'TEMPLATE_NOT_FOUND',
          `Template not found: ${parsed.template}`,
        );
      }
      if (tpl.type !== parsed.type) {
        throw new BadRequestError(
          'TEMPLATE_TYPE_MISMATCH',
          `Template '${tpl.id}' is for type '${tpl.type}', request asked for '${parsed.type}'`,
        );
      }
      body = applyPlaceholders(tpl.body, { title: parsed.title, project: projectId });
    }

    const frontmatter: Frontmatter = {
      id,
      title: parsed.title,
      project: projectId,
      type: parsed.type,
      status: parsed.status ?? 'draft',
      ...(taskState !== undefined ? { task_state: taskState } : {}),
      created_at: now,
      updated_at: now,
      tags: parsed.tags ?? [],
    };

    let revision: string;
    if (project.metadataMode === 'sidecar') {
      const entry = sidecarEntryFromFrontmatter(frontmatter);
      const fileRevision = await this.fs.writeRaw(relPath, body);
      await this.sidecarStore.set(projectId, sidecarKeyOf(projectId, relPath), entry);
      revision = sidecarRevision(fileRevision, entry);
    } else {
      revision = await this.fs.write(relPath, { frontmatter, body });
    }
    try {
      this.documentsRepo.upsert({
        id,
        project_id: projectId,
        title: frontmatter.title,
        type: frontmatter.type,
        status: frontmatter.status,
        path: relPath,
        tags: frontmatter.tags,
        readOnly: false,
        body,
        created_at: frontmatter.created_at,
        updated_at: frontmatter.updated_at,
        revision,
        task_state: storedTaskState(frontmatter.task_state),
      });
    } catch (err) {
      // Roll back disk write to keep DB+FS consistent.
      await this.fs.delete(relPath).catch(() => undefined);
      if (project.metadataMode === 'sidecar') {
        await this.sidecarStore
          .delete(projectId, sidecarKeyOf(projectId, relPath))
          .catch(() => undefined);
      }
      throw err;
    }

    this.linkService.rebuildForDocument(id, frontmatter.title, body);
    this.tagsService.rebuildForDocument(id, frontmatter.tags);
    this.graphService.invalidate(projectId);

    return {
      ...frontmatter,
      project_id: projectId,
      path: relPath,
      readOnly: false,
      revision,
      body,
    };
  }

  /**
   * Capture: create a draft To do backlog item from a title alone, into the
   * given project or the designated Inbox. The id is the client's, so a
   * resent capture returns the item as it is now, wherever it lives.
   */
  async capture(input: CaptureRequest): Promise<CaptureResult> {
    const projectId = input.project_id ?? this.inbox.requireId();
    this.getProject(projectId);
    return this.queue.run(projectId, async () => {
      const existing = this.documentsRepo.find(input.id);
      if (existing) {
        if (existing.type !== 'backlog_item' || existing.title !== input.title) {
          throw new ConflictError(
            'CAPTURE_ID_CONFLICT',
            `Id ${input.id} already belongs to a different document; capture with a new id.`,
          );
        }
        return { document: await this.get(input.id), created: false };
      }
      this.assertProjectAcceptsBacklogItems(projectId);
      const document = await this.createInQueue(
        projectId,
        { type: 'backlog_item', title: input.title, status: 'draft' },
        { id: input.id },
      );
      return { document, created: true };
    });
  }

  async update(
    id: string,
    input: UpdateDocumentRequest,
    ifMatch?: string,
    options: UpdateOptions = {},
  ): Promise<Document> {
    return this.inDocumentQueue(id, (summary) =>
      this.updateInQueue(summary, input, ifMatch, options),
    );
  }

  private async updateInQueue(
    summary: DocumentSummary,
    input: UpdateDocumentRequest,
    ifMatch: string | undefined,
    options: UpdateOptions,
  ): Promise<Document> {
    if (input.task_state !== undefined && summary.type !== 'backlog_item') {
      throw taskStateNotAllowed(summary.type);
    }
    // The task state to write, if any. Otherwise the stored value is kept.
    const nextTaskState: unknown =
      input.task_state ??
      (summary.type === 'backlog_item' ? options.importedTaskState?.value : undefined);
    const project = this.assertProjectWritable(summary.project_id);

    // Validate the caller's revision against what is on disk right now, inside
    // the project queue, so out-of-band edits and overlapping saves both 409.
    // A missing If-Match is accepted (unconditional write).
    const existing = await this.fs.read(summary.path);
    if (ifMatch !== undefined) {
      const current = await this.currentRevision(summary, existing);
      if (ifMatch !== current) {
        throw new ConflictError(
          'DOCUMENT_VERSION_MISMATCH',
          `Document was modified since If-Match=${ifMatch}; current revision=${current}`,
        );
      }
    }
    const now = this.now();
    if (project.metadataMode === 'sidecar' && !hasOwnFrontmatter(summary, existing)) {
      if (input.task_state !== undefined) throw taskStateNotAllowed('sidecar-backed document');
      return this.updateViaSidecar(summary, existing, input, now);
    }
    const nextStatus = input.status ?? summary.status;
    const nextFrontmatter = summary.readOnly
      ? FrontmatterSchema.parse({
          id: summary.id,
          title: input.title ?? summary.title,
          project: summary.project_id,
          type: summary.type,
          status: nextStatus,
          ...(nextTaskState !== undefined ? { task_state: nextTaskState } : {}),
          created_at: summary.created_at,
          updated_at: now,
          tags: input.tags ?? summary.tags,
        })
      : buildUpdatedFrontmatter(summary, existing, input, nextStatus, nextTaskState, now);
    const nextBody = input.body ?? existing.body;

    // Move the file when archive status changes.
    const nextPath =
      nextStatus !== summary.status
        ? nextStatus === 'archived'
          ? archivePath(summary.path)
          : summary.status === 'archived'
            ? unarchivePath(summary.path)
            : summary.path
        : summary.path;

    const revision = await this.fs.write(nextPath, {
      frontmatter: nextFrontmatter,
      body: nextBody,
    });
    if (nextPath !== summary.path) {
      await this.fs.delete(summary.path).catch(() => undefined);
    }

    this.documentsRepo.upsert({
      id: summary.id,
      project_id: summary.project_id,
      title: nextFrontmatter.title,
      type: nextFrontmatter.type,
      status: nextFrontmatter.status,
      path: nextPath,
      tags: nextFrontmatter.tags,
      readOnly: false,
      body: nextBody,
      created_at: summary.created_at,
      updated_at: now,
      revision,
      task_state: storedTaskState(nextFrontmatter.task_state),
    });

    this.linkService.rebuildForDocument(
      summary.id,
      nextFrontmatter.title,
      nextBody,
      summary.title,
    );
    this.tagsService.rebuildForDocument(summary.id, nextFrontmatter.tags);
    this.graphService.invalidate(summary.project_id);

    return {
      ...nextFrontmatter,
      project_id: summary.project_id,
      path: nextPath,
      readOnly: false,
      revision,
      body: nextBody,
    };
  }

  /**
   * Update path for sidecar-mode documents: the `.md` file holds body only,
   * and all Backlogger metadata (incl. archive `status`) lives in the sidecar.
   * The file is never moved — archive state is metadata, not path.
   */
  private async updateViaSidecar(
    summary: DocumentSummary,
    existing: RawDocument,
    input: UpdateDocumentRequest,
    now: string,
  ): Promise<Document> {
    const nextTitle = input.title ?? summary.title;
    const nextStatus = input.status ?? summary.status;
    const nextTags = input.tags ?? summary.tags;
    const nextBody = input.body ?? existing.body;
    const entry: SidecarEntry = {
      id: summary.id,
      title: nextTitle,
      type: summary.type,
      status: nextStatus,
      tags: nextTags,
      created_at: summary.created_at,
      updated_at: now,
    };

    const fileRevision = await this.fs.writeRaw(summary.path, nextBody);
    await this.sidecarStore.set(
      summary.project_id,
      sidecarKeyOf(summary.project_id, summary.path),
      entry,
    );
    const revision = sidecarRevision(fileRevision, entry);

    this.documentsRepo.upsert({
      id: summary.id,
      project_id: summary.project_id,
      title: nextTitle,
      type: summary.type,
      status: nextStatus,
      path: summary.path,
      tags: nextTags,
      readOnly: false,
      body: nextBody,
      created_at: summary.created_at,
      updated_at: now,
      revision,
      task_state: null,
    });

    this.linkService.rebuildForDocument(summary.id, nextTitle, nextBody, summary.title);
    this.tagsService.rebuildForDocument(summary.id, nextTags);
    this.graphService.invalidate(summary.project_id);

    return {
      id: summary.id,
      project_id: summary.project_id,
      title: nextTitle,
      type: summary.type,
      status: nextStatus,
      path: summary.path,
      tags: nextTags,
      readOnly: false,
      created_at: summary.created_at,
      updated_at: now,
      revision,
      body: nextBody,
    };
  }

  async delete(id: string): Promise<void> {
    return this.inDocumentQueue(id, (summary) => this.deleteInQueue(summary));
  }

  private async deleteInQueue(summary: DocumentSummary): Promise<void> {
    const id = summary.id;
    const project = this.assertProjectWritable(summary.project_id);

    let viaSidecar = false;
    if (!summary.readOnly) {
      const existing = await this.fs.read(summary.path);
      viaSidecar = project.metadataMode === 'sidecar' && !hasOwnFrontmatter(summary, existing);
      if (!viaSidecar) assertEditableBackloggerDocument(summary, existing);
    }

    this.documentsRepo.delete(id);
    this.linkService.onDocumentDeleted(id);
    this.graphService.invalidate(summary.project_id);
    if (viaSidecar) {
      await this.sidecarStore
        .delete(summary.project_id, sidecarKeyOf(summary.project_id, summary.path))
        .catch(() => undefined);
    }
    await this.fs.delete(summary.path).catch(() => undefined);
  }

  /**
   * Move a document to a different project-relative folder, preserving its id,
   * title, body, and archive state. Only real Backlogger documents can be
   * moved; derived plain-Markdown rows have path-derived ids that must not
   * change. The reserved `archived/` folder is rejected — archive state is
   * controlled through `status`, not the folder.
   */
  async move(id: string, targetFolder: string): Promise<Document> {
    return this.inDocumentQueue(id, (summary) => this.moveInQueue(summary, targetFolder));
  }

  private async moveInQueue(summary: DocumentSummary, targetFolder: string): Promise<Document> {
    const project = this.assertProjectWritable(summary.project_id);

    if (isArchivedFolder(targetFolder)) {
      throw new BadRequestError(
        'INVALID_FOLDER',
        "Cannot move a document into the reserved 'archived' folder; archive it instead.",
      );
    }

    const existing = await this.fs.read(summary.path);
    const viaSidecar =
      project.metadataMode === 'sidecar' && !hasOwnFrontmatter(summary, existing);
    if (!viaSidecar) assertEditableBackloggerDocument(summary, existing);

    const filename = summary.path.split('/').pop() ?? '';
    const activePath = targetFolder
      ? `${summary.project_id}/${targetFolder}/${filename}`
      : `${summary.project_id}/${filename}`;
    const nextPath = isArchivedPath(summary.path) ? archivePath(activePath) : activePath;

    if (nextPath === summary.path) {
      return { ...summary, readOnly: false, body: existing.body };
    }

    const now = this.now();

    if (viaSidecar) {
      const fileRevision = await this.fs.writeRaw(nextPath, existing.body);
      await this.fs.delete(summary.path).catch(() => undefined);
      const fromKey = sidecarKeyOf(summary.project_id, summary.path);
      const toKey = sidecarKeyOf(summary.project_id, nextPath);
      await this.sidecarStore.rename(summary.project_id, fromKey, toKey);
      const moved = await this.sidecarStore.get(summary.project_id, toKey);
      let revision = fileRevision;
      if (moved) {
        const entry = { ...moved, updated_at: now };
        await this.sidecarStore.set(summary.project_id, toKey, entry);
        revision = sidecarRevision(fileRevision, entry);
      }
      this.documentsRepo.upsert({
        id: summary.id,
        project_id: summary.project_id,
        title: summary.title,
        type: summary.type,
        status: summary.status,
        path: nextPath,
        tags: summary.tags,
        readOnly: false,
        body: existing.body,
        created_at: summary.created_at,
        updated_at: now,
        revision,
        task_state: null,
      });
      this.graphService.invalidate(summary.project_id);
      return {
        id: summary.id,
        project_id: summary.project_id,
        title: summary.title,
        type: summary.type,
        status: summary.status,
        path: nextPath,
        tags: summary.tags,
        readOnly: false,
        created_at: summary.created_at,
        updated_at: now,
        revision,
        body: existing.body,
      };
    }

    const nextFrontmatter = FrontmatterSchema.parse({ ...existing.frontmatter, updated_at: now });

    const revision = await this.fs.write(nextPath, {
      frontmatter: nextFrontmatter,
      body: existing.body,
    });
    await this.fs.delete(summary.path).catch(() => undefined);

    this.documentsRepo.upsert({
      id: summary.id,
      project_id: summary.project_id,
      title: nextFrontmatter.title,
      type: nextFrontmatter.type,
      status: nextFrontmatter.status,
      path: nextPath,
      tags: nextFrontmatter.tags,
      readOnly: false,
      body: existing.body,
      created_at: summary.created_at,
      updated_at: now,
      revision,
      task_state: storedTaskState(nextFrontmatter.task_state),
    });

    this.graphService.invalidate(summary.project_id);

    return {
      ...nextFrontmatter,
      project_id: summary.project_id,
      path: nextPath,
      readOnly: false,
      revision,
      body: existing.body,
    };
  }

  /**
   * File a backlog item into another writable native project, keeping its id
   * and every byte of its file except the frontmatter `project:` value. The
   * file keeps its project-relative path. Holds both projects' queues, taken
   * in sorted order. Writes the target, then deletes the source, then updates
   * the index; a crash in between leaves two copies that the reindex resolves.
   */
  async file(id: string, targetProjectId: string, revision: string): Promise<Document> {
    const before = this.findOrThrow(id);
    if (before.project_id === targetProjectId) return this.get(id);
    this.getProject(targetProjectId);
    const [first, second] = [before.project_id, targetProjectId].sort() as [string, string];
    return this.queue.run(first, () =>
      this.queue.run(second, () => this.fileInQueues(id, targetProjectId, revision, [first, second])),
    );
  }

  private async fileInQueues(
    id: string,
    targetProjectId: string,
    revision: string,
    held: readonly string[],
  ): Promise<Document> {
    const summary = this.findOrThrow(id);
    if (summary.project_id === targetProjectId) return this.get(id);
    if (summary.type !== 'backlog_item') {
      throw new BadRequestError(
        'NOT_A_BACKLOG_ITEM',
        `Only backlog items can be filed; this document is a ${summary.type}.`,
      );
    }
    const sourceId = summary.project_id;
    this.assertProjectAcceptsBacklogItems(sourceId);
    this.assertProjectAcceptsBacklogItems(targetProjectId);

    const raw = await this.fs.read(summary.path);
    // The item moved to a third project while this filing waited for the queues.
    if (!held.includes(sourceId) || raw.revision !== revision) {
      throw new ConflictError(
        'REVISION_CONFLICT',
        `Document was modified since revision=${revision}; current revision=${raw.revision}`,
        { currentRevision: raw.revision, currentProjectId: sourceId },
      );
    }
    assertEditableBackloggerDocument(summary, raw);

    const text = await this.fs.readText(summary.path);
    const rewritten = rewriteProjectLine(text, targetProjectId);
    const check = FrontmatterSchema.safeParse(parseFrontmatter(rewritten));
    if (!check.success || check.data.id !== id || check.data.project !== targetProjectId) {
      throw frontmatterNotRewritable();
    }

    const nextPath = `${targetProjectId}/${summary.path.slice(sourceId.length + 1)}`;
    const occupant = this.documentsRepo.findByPath(nextPath);
    if (occupant && occupant.id !== id) {
      throw new ConflictError(
        'TARGET_PATH_TAKEN',
        `Another document already lives at ${nextPath}.`,
      );
    }

    const nextRevision = await this.fs.writeRaw(nextPath, rewritten);
    await this.fs.delete(summary.path);

    const indexed = this.documentsRepo.upsert({
      id,
      project_id: targetProjectId,
      title: summary.title,
      type: summary.type,
      status: summary.status,
      path: nextPath,
      tags: summary.tags,
      readOnly: false,
      body: raw.body,
      created_at: summary.created_at,
      updated_at: summary.updated_at,
      revision: nextRevision,
      task_state: storedTaskState(raw.frontmatter.task_state),
    });
    this.graphService.invalidate(sourceId);
    this.graphService.invalidate(targetProjectId);

    return { ...indexed, readOnly: false, body: raw.body };
  }

  /**
   * Run a mutation of one document inside its project's queue. The summary is
   * re-read once the operation holds the queue, so it reflects every mutation
   * that committed before it (a deleted document is a 404, a moved or archived
   * one has its new path).
   */
  private async inDocumentQueue<T>(
    id: string,
    operation: (summary: DocumentSummary) => Promise<T>,
  ): Promise<T> {
    const before = this.findOrThrow(id);
    return this.queue.run(before.project_id, () => operation(this.findOrThrow(id)));
  }

  /**
   * The revision of a document as persisted right now: its file, plus its
   * sidecar entry when the file carries no Backlogger frontmatter of its own.
   * Must agree with the revision the reindex projects.
   */
  private async currentRevision(summary: DocumentSummary, raw: RawDocument): Promise<string> {
    if (hasOwnFrontmatter(summary, raw)) return raw.revision;
    const entry = await this.sidecarStore.get(
      summary.project_id,
      sidecarKeyOf(summary.project_id, summary.path),
    );
    return entry ? sidecarRevision(raw.revision, entry) : raw.revision;
  }

  private findOrThrow(id: string): DocumentSummary {
    const summary = this.documentsRepo.find(id);
    if (!summary) throw new NotFoundError('DOCUMENT_NOT_FOUND', `Document not found: ${id}`);
    return summary;
  }

  private getProject(projectId: string): ProjectRecord {
    const project = this.projectsRepo.find(projectId);
    if (!project) {
      throw new NotFoundError('PROJECT_NOT_FOUND', `Project not found: ${projectId}`);
    }
    return project;
  }

  private assertProjectWritable(projectId: string): ProjectRecord {
    const project = this.getProject(projectId);
    if (project.readOnly) {
      throw new ConflictError(
        'PROJECT_READ_ONLY',
        'This project is read-only. Disable read-only mode before editing it.',
      );
    }
    return project;
  }

  /** Writable and frontmatter-mode: a project that can hold a new or filed backlog item. */
  private assertProjectAcceptsBacklogItems(projectId: string): ProjectRecord {
    const project = this.getProject(projectId);
    if (project.readOnly || project.metadataMode === 'sidecar') {
      throw new ConflictError(
        'PROJECT_NOT_WRITABLE',
        `Project ${projectId} is read-only or sidecar-backed and cannot take backlog items.`,
      );
    }
    return project;
  }

  private applyProjectReadOnly(
    project: ProjectRecord,
    documents: DocumentSummary[],
  ): DocumentSummary[] {
    return documents.map((doc) => ({ ...doc, readOnly: project.readOnly }));
  }
}

function buildUpdatedFrontmatter(
  summary: DocumentSummary,
  raw: RawDocument,
  input: UpdateDocumentRequest,
  nextStatus: Frontmatter['status'],
  nextTaskState: unknown,
  now: string,
): Frontmatter {
  assertEditableBackloggerDocument(summary, raw);
  // Spreading the existing frontmatter keeps an unrecognised `task_state`
  // verbatim; only an explicit task-state change replaces it.
  return FrontmatterSchema.parse({
    ...raw.frontmatter,
    title: input.title ?? summary.title,
    status: nextStatus,
    ...(nextTaskState !== undefined ? { task_state: nextTaskState } : {}),
    tags: input.tags ?? summary.tags,
    updated_at: now,
  });
}

function taskStateNotAllowed(what: string): BadRequestError {
  return new BadRequestError(
    'TASK_STATE_NOT_ALLOWED',
    `Only backlog items have a task state; this document is a ${what}.`,
  );
}

function assertEditableBackloggerDocument(summary: DocumentSummary, raw: RawDocument): void {
  const parsed = FrontmatterSchema.safeParse(raw.frontmatter);
  if (
    !parsed.success ||
    parsed.data.id !== summary.id ||
    parsed.data.project !== summary.project_id
  ) {
    throw new ConflictError(
      'DERIVED_DOCUMENT_READ_ONLY',
      'This document was indexed from plain Markdown and cannot be modified until Backlogger frontmatter is added.',
    );
  }
  const pathStatus = isArchivedPath(summary.path) ? 'archived' : 'active';
  if (pathStatus === 'archived' && parsed.data.status !== 'archived') {
    throw new ConflictError(
      'DERIVED_DOCUMENT_READ_ONLY',
      'This document has inconsistent archive metadata and cannot be modified until it is reindexed.',
    );
  }
}

/**
 * Replace the value of the frontmatter's top-level `project:` line, leaving
 * every other byte as it was. Throws unless exactly one such line exists.
 */
function rewriteProjectLine(text: string, projectId: string): string {
  const match = /^(---\r?\n)([\s\S]*?\r?\n)(---(?:\r?\n|$))/.exec(text);
  const lines = match ? match[2]!.match(/^project:[^\r\n]*$/gm) : null;
  if (!match || !lines || lines.length !== 1) throw frontmatterNotRewritable();
  const block = match[2]!.replace(/^project:[^\r\n]*$/m, `project: ${projectId}`);
  return match[1] + block + text.slice(match[1]!.length + match[2]!.length);
}

/** Frontmatter whose `project:` line Backlogger cannot rewrite without touching other bytes. */
function frontmatterNotRewritable(): ConflictError {
  return new ConflictError(
    'DERIVED_DOCUMENT_READ_ONLY',
    'This document has frontmatter Backlogger cannot rewrite safely; edit its project line by hand.',
  );
}

function parseFrontmatter(text: string): Record<string, unknown> {
  try {
    return { ...(matter(text).data as Record<string, unknown>) };
  } catch {
    return {};
  }
}

/** Sidecar key for a document: its project-relative path without the project id. */
function sidecarKeyOf(projectId: string, docPath: string): string {
  const prefix = `${projectId}/`;
  return docPath.startsWith(prefix) ? docPath.slice(prefix.length) : docPath;
}

function sidecarEntryFromFrontmatter(fm: Frontmatter): SidecarEntry {
  return {
    id: fm.id,
    title: fm.title,
    type: fm.type,
    status: fm.status,
    tags: fm.tags,
    created_at: fm.created_at,
    updated_at: fm.updated_at,
  };
}

/** True when the on-disk file carries this document's own Backlogger frontmatter. */
function hasOwnFrontmatter(summary: DocumentSummary, raw: RawDocument): boolean {
  const fm = FrontmatterSchema.safeParse(raw.frontmatter);
  return fm.success && fm.data.id === summary.id && fm.data.project === summary.project_id;
}

/**
 * Build a filename `<slug>-<short-id>.md` from a title and uuid.
 * Slug is ≤ 60 chars of `[a-z0-9-]`; short id is the first 8 uuid chars.
 */
export function buildFilename(title: string, uuid: string): string {
  const slug = slugify(title).slice(0, 60) || 'untitled';
  const shortId = uuid.replace(/-/g, '').slice(0, 8);
  return `${slug}-${shortId}.md`;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export type { RawDocument };
