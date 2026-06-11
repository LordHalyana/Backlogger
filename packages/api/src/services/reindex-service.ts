import { createHash } from 'node:crypto';
import * as path from 'node:path';
import {
  FrontmatterSchema,
  ProjectIdSchema,
  isArchivedPath,
  type DocumentStatus,
  type Frontmatter,
} from '@backlogger/shared';
import type { DocumentsRepo } from '../db/documents-repo.js';
import type { ProjectsRepo } from '../db/projects-repo.js';
import type { FsRepository, RawDocument } from '../fs/index.js';
import type { LinkService } from './link-service.js';
import type { TagsService } from './tags-service.js';
import type { GraphService } from './graph-service.js';

export interface ReindexReport {
  scanned: number;
  inserted: number;
  skipped: Array<{ path: string; reason: string }>;
}

export interface ReloadReport {
  projectId: string;
  added: number;
  updated: number;
  removed: number;
  skipped: Array<{ path: string; reason: string }>;
  durationMs: number;
  removedIds: string[];
}

/** Thrown when a per-project reload is already running for that project. */
export class ReloadInProgressError extends Error {
  override readonly name = 'ReloadInProgressError';
  constructor(public readonly projectId: string) {
    super(`Reload already in progress for project: ${projectId}`);
  }
}

export interface ReindexServiceDeps {
  documentsRepo: DocumentsRepo;
  projectsRepo: ProjectsRepo;
  fs: FsRepository;
  linkService: LinkService;
  tagsService: TagsService;
  graphService: GraphService;
}

/**
 * Walks `<dataDir>/projects/` and rebuilds the `documents` table from disk.
 * Backlogger frontmatter is used when present and valid. Plain Markdown files
 * are indexed with derived read-only metadata so mounted docs folders are
 * browsable without rewriting their source files.
 */
export class ReindexService {
  private readonly documentsRepo: DocumentsRepo;
  private readonly projectsRepo: ProjectsRepo;
  private readonly fs: FsRepository;
  private readonly linkService: LinkService;
  private readonly tagsService: TagsService;
  private readonly graphService: GraphService;
  private readonly inFlight = new Set<string>();

  constructor(deps: ReindexServiceDeps) {
    this.documentsRepo = deps.documentsRepo;
    this.projectsRepo = deps.projectsRepo;
    this.fs = deps.fs;
    this.linkService = deps.linkService;
    this.tagsService = deps.tagsService;
    this.graphService = deps.graphService;
  }

  async run(): Promise<ReindexReport> {
    const report: ReindexReport = { scanned: 0, inserted: 0, skipped: [] };
    this.documentsRepo.truncate();
    this.linkService.truncate();
    this.tagsService.truncate();

    for await (const doc of this.fs.walk()) {
      report.scanned += 1;
      const projectId = doc.path.split('/')[0] ?? '';
      if (!this.ensureProjectForIndex(projectId)) {
        report.skipped.push({ path: doc.path, reason: 'invalid project folder' });
        continue;
      }
      const indexed = metadataForIndex(doc, projectId);
      this.documentsRepo.upsert({
        id: indexed.frontmatter.id,
        project_id: projectId,
        title: indexed.frontmatter.title,
        type: indexed.frontmatter.type,
        status: statusFromPath(doc.path, indexed.frontmatter.status),
        path: doc.path,
        tags: indexed.frontmatter.tags,
        readOnly: indexed.readOnly,
        body: doc.body,
        created_at: indexed.frontmatter.created_at,
        updated_at: indexed.frontmatter.updated_at,
      });
      this.linkService.rebuildForDocument(indexed.frontmatter.id, indexed.frontmatter.title, doc.body);
      this.tagsService.rebuildForDocument(indexed.frontmatter.id, indexed.frontmatter.tags);
      report.inserted += 1;
    }
    // Full reindex rewrote every project's links/tags → drop all graph caches.
    this.graphService.invalidate();
    return report;
  }

  /**
   * Reindex a single project: walks `data/projects/<id>/`, upserts present
   * files, deletes rows whose files vanished, refreshes links + tags + FTS.
   * Throws `ReloadInProgressError` if a reload is already running for `projectId`.
   */
  async runProject(projectId: string): Promise<ReloadReport> {
    if (this.inFlight.has(projectId)) {
      throw new ReloadInProgressError(projectId);
    }
    this.inFlight.add(projectId);
    const started = Date.now();
    try {
      const report: ReloadReport = {
        projectId,
        added: 0,
        updated: 0,
        removed: 0,
        skipped: [],
        durationMs: 0,
        removedIds: [],
      };

      // Snapshot what we already have on disk-of-record.
      const existing = new Map(
        this.documentsRepo.listByProject(projectId).map((d) => [d.id, d] as const),
      );

      for await (const doc of this.fs.walkProject(projectId)) {
        const indexed = metadataForIndex(doc, projectId);
        const wasPresent = existing.has(indexed.frontmatter.id);
        this.documentsRepo.upsert({
          id: indexed.frontmatter.id,
          project_id: projectId,
          title: indexed.frontmatter.title,
          type: indexed.frontmatter.type,
          status: statusFromPath(doc.path, indexed.frontmatter.status),
          path: doc.path,
          tags: indexed.frontmatter.tags,
          readOnly: indexed.readOnly,
          body: doc.body,
          created_at: indexed.frontmatter.created_at,
          updated_at: indexed.frontmatter.updated_at,
        });
        this.linkService.rebuildForDocument(indexed.frontmatter.id, indexed.frontmatter.title, doc.body);
        this.tagsService.rebuildForDocument(indexed.frontmatter.id, indexed.frontmatter.tags);
        if (wasPresent) report.updated += 1;
        else report.added += 1;
        existing.delete(indexed.frontmatter.id);
      }

      // Anything still in `existing` lost its backing file → purge.
      for (const [id] of existing) {
        this.documentsRepo.delete(id);
        this.linkService.onDocumentDeleted(id);
        report.removedIds.push(id);
        report.removed += 1;
      }

      // Documents/links/tags for this project changed → drop its graph cache so
      // GET /:id/graph rebuilds instead of serving a stale (TTL-cached) payload.
      this.graphService.invalidate(projectId);

      report.durationMs = Date.now() - started;
      return report;
    } finally {
      this.inFlight.delete(projectId);
    }
  }

  private ensureProjectForIndex(projectId: string): boolean {
    if (!ProjectIdSchema.safeParse(projectId).success) return false;
    if (this.projectsRepo.exists(projectId)) return true;
    const now = new Date().toISOString();
    this.projectsRepo.insert({
      id: projectId,
      name: idToName(projectId),
      description: null,
      readOnly: true,
      created_at: now,
      updated_at: now,
    });
    return true;
  }
}

interface IndexedMetadata {
  frontmatter: Frontmatter;
  readOnly: boolean;
}

function metadataForIndex(doc: RawDocument, projectId: string): IndexedMetadata {
  const parsed = FrontmatterSchema.safeParse(doc.frontmatter);
  if (parsed.success) {
    if (parsed.data.project === projectId) {
      return { frontmatter: parsed.data, readOnly: false };
    }
    return {
      frontmatter: repairMismatchedFrontmatter(doc, projectId, parsed.data),
      readOnly: true,
    };
  }

  return { frontmatter: deriveFrontmatter(doc, projectId), readOnly: true };
}

function repairMismatchedFrontmatter(
  doc: RawDocument,
  projectId: string,
  source: Frontmatter,
): Frontmatter {
  return {
    ...source,
    id: derivedDocumentId(doc.path),
    project: projectId,
    status: statusFromPath(doc.path, source.status),
  };
}

function deriveFrontmatter(doc: RawDocument, projectId: string): Frontmatter {
  const timestamp = doc.updatedAt ?? new Date(0).toISOString();
  return {
    id: derivedDocumentId(doc.path),
    title: deriveTitle(doc.path, doc.body),
    project: projectId,
    type: 'note',
    status: statusFromPath(doc.path, 'active'),
    created_at: doc.createdAt ?? timestamp,
    updated_at: timestamp,
    tags: [],
  };
}

function statusFromPath(docPath: string, fallback: DocumentStatus): DocumentStatus {
  return isArchivedPath(docPath) ? 'archived' : fallback === 'archived' ? 'active' : fallback;
}

function deriveTitle(docPath: string, body: string): string {
  const heading = body.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  if (heading) return heading.slice(0, 200);
  const base = path.basename(docPath, '.md').replace(/[-_]+/g, ' ').trim();
  return titleCase(base || 'Untitled').slice(0, 200);
}

function titleCase(value: string): string {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

function idToName(id: string): string {
  return id
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function derivedDocumentId(docPath: string): string {
  const bytes = createHash('sha1').update(`backlogger-derived:${docPath}`).digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
