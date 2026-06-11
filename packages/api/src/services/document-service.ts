import { v4 as uuidv4 } from 'uuid';
import {
  archivePath,
  CreateDocumentRequestSchema,
  DOCUMENT_TYPE_TO_SUBDIR,
  FrontmatterSchema,
  isArchivedPath,
  unarchivePath,
  type CreateDocumentRequest,
  type Document,
  type DocumentSummary,
  type Frontmatter,
  type Project,
  type UpdateDocumentRequest,
} from '@backlogger/shared';
import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';
import type { FsRepository, RawDocument } from '../fs/index.js';
import type { DocumentsRepo } from '../db/documents-repo.js';
import type { LinkService } from './link-service.js';
import type { TagsService } from './tags-service.js';
import type { GraphService } from './graph-service.js';
import type { ProjectsRepo } from '../db/projects-repo.js';
import { applyPlaceholders, type TemplateRegistry } from '../templates/registry.js';

export interface DocumentServiceDeps {
  documentsRepo: DocumentsRepo;
  projectsRepo: ProjectsRepo;
  fs: FsRepository;
  templates: TemplateRegistry;
  linkService: LinkService;
  tagsService: TagsService;
  graphService: GraphService;
  now?: () => string;
  newId?: () => string;
}

export class DocumentService {
  private readonly documentsRepo: DocumentsRepo;
  private readonly projectsRepo: ProjectsRepo;
  private readonly fs: FsRepository;
  private readonly templates: TemplateRegistry;
  private readonly linkService: LinkService;
  private readonly tagsService: TagsService;
  private readonly graphService: GraphService;
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
    return { ...summary, readOnly: project.readOnly, body: raw.body };
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

  async create(projectId: string, input: CreateDocumentRequest): Promise<Document> {
    this.assertProjectWritable(projectId);
    // Re-validate to apply defaults from the schema (status, tags).
    const parsed = CreateDocumentRequestSchema.parse(input);

    const id = this.newId();
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
      created_at: now,
      updated_at: now,
      tags: parsed.tags ?? [],
    };

    await this.fs.write(relPath, { frontmatter, body });
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
      });
    } catch (err) {
      // Roll back disk write to keep DB+FS consistent.
      await this.fs.delete(relPath).catch(() => undefined);
      throw err;
    }

    this.linkService.rebuildForDocument(id, frontmatter.title, body);
    this.tagsService.rebuildForDocument(id, frontmatter.tags);
    this.graphService.invalidate(projectId);

    return { ...frontmatter, project_id: projectId, path: relPath, readOnly: false, body };
  }

  async update(
    id: string,
    input: UpdateDocumentRequest,
    ifMatch?: string,
  ): Promise<Document> {
    const summary = this.documentsRepo.find(id);
    if (!summary) throw new NotFoundError('DOCUMENT_NOT_FOUND', `Document not found: ${id}`);
    this.assertProjectWritable(summary.project_id);

    if (ifMatch !== undefined && ifMatch !== summary.updated_at) {
      throw new ConflictError(
        'DOCUMENT_VERSION_MISMATCH',
        `Document was modified since If-Match=${ifMatch}; current updated_at=${summary.updated_at}`,
      );
    }

    const existing = await this.fs.read(summary.path);
    const now = this.now();
    const nextStatus = input.status ?? summary.status;
    const nextFrontmatter = summary.readOnly
      ? FrontmatterSchema.parse({
          id: summary.id,
          title: input.title ?? summary.title,
          project: summary.project_id,
          type: summary.type,
          status: nextStatus,
          created_at: summary.created_at,
          updated_at: now,
          tags: input.tags ?? summary.tags,
        })
      : buildUpdatedFrontmatter(summary, existing, input, nextStatus, now);
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

    await this.fs.write(nextPath, { frontmatter: nextFrontmatter, body: nextBody });
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
      body: nextBody,
    };
  }

  async delete(id: string): Promise<void> {
    const summary = this.documentsRepo.find(id);
    if (!summary) throw new NotFoundError('DOCUMENT_NOT_FOUND', `Document not found: ${id}`);
    this.assertProjectWritable(summary.project_id);
    if (!summary.readOnly) {
      const existing = await this.fs.read(summary.path);
      assertEditableBackloggerDocument(summary, existing);
    }
    this.documentsRepo.delete(id);
    this.linkService.onDocumentDeleted(id);
    this.graphService.invalidate(summary.project_id);
    await this.fs.delete(summary.path).catch(() => undefined);
  }

  private getProject(projectId: string): Project {
    const project = this.projectsRepo.find(projectId);
    if (!project) {
      throw new NotFoundError('PROJECT_NOT_FOUND', `Project not found: ${projectId}`);
    }
    return project;
  }

  private assertProjectWritable(projectId: string): Project {
    const project = this.getProject(projectId);
    if (project.readOnly) {
      throw new ConflictError(
        'PROJECT_READ_ONLY',
        'This project is read-only. Disable read-only mode before editing it.',
      );
    }
    return project;
  }

  private applyProjectReadOnly(
    project: Project,
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
  now: string,
): Frontmatter {
  assertEditableBackloggerDocument(summary, raw);
  return FrontmatterSchema.parse({
    ...raw.frontmatter,
    title: input.title ?? summary.title,
    status: nextStatus,
    tags: input.tags ?? summary.tags,
    updated_at: now,
  });
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
