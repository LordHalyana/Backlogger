import { createHash } from 'node:crypto';
import * as path from 'node:path';
import {
  FrontmatterSchema,
  ProjectIdSchema,
  isArchivedPath,
  storedTaskState,
  type DocumentStatus,
  type DuplicateFile,
  type Frontmatter,
  type SidecarEntry,
  type SidecarIndex,
} from '@backlogger/shared';
import { sidecarRevision, type SidecarStore } from '../fs/index.js';
import type { DocumentsRepo } from '../db/documents-repo.js';
import type { ProjectsRepo } from '../db/projects-repo.js';
import type { FsRepository, RawDocument } from '../fs/index.js';
import type { LinkService } from './link-service.js';
import type { TagsService } from './tags-service.js';
import type { GraphService } from './graph-service.js';
import type { WriteCoordinator } from './write-coordinator.js';
import type { InboxService } from './inbox-service.js';

export interface ReindexReport {
  scanned: number;
  inserted: number;
  skipped: Array<{ path: string; reason: string }>;
  duplicates: DuplicateFile[];
}

export interface ReloadReport {
  projectId: string;
  added: number;
  updated: number;
  removed: number;
  skipped: Array<{ path: string; reason: string }>;
  durationMs: number;
  removedIds: string[];
  duplicates: DuplicateFile[];
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
  sidecarStore: SidecarStore;
  /** Reloads run as coordinated commands, full reindexes exclusively. */
  coordinator: WriteCoordinator;
  inbox: InboxService;
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
  private readonly sidecarStore: SidecarStore;
  private readonly coordinator: WriteCoordinator;
  private readonly inbox: InboxService;
  private readonly inFlight = new Set<string>();

  constructor(deps: ReindexServiceDeps) {
    this.documentsRepo = deps.documentsRepo;
    this.projectsRepo = deps.projectsRepo;
    this.fs = deps.fs;
    this.linkService = deps.linkService;
    this.tagsService = deps.tagsService;
    this.graphService = deps.graphService;
    this.sidecarStore = deps.sidecarStore;
    this.coordinator = deps.coordinator;
    this.inbox = deps.inbox;
  }

  /**
   * Full reindex: rebuild every derived index from disk with the workspace
   * gate held exclusively. Operational tables (receipts, pending operations,
   * guards) are not derived and are left as they are.
   */
  run(): Promise<ReindexReport> {
    return this.coordinator.exclusive(() => this.rebuildHeld());
  }

  /** `run` for a caller already holding the gate exclusively (startup). */
  async rebuildHeld(): Promise<ReindexReport> {
    const report: ReindexReport = { scanned: 0, inserted: 0, skipped: [], duplicates: [] };
    // id → the copy chosen for it so far, and the copies left out.
    const kept = new Map<
      string,
      { doc: RawDocument; projectId: string; indexed: IndexedMetadata }
    >();
    const leftOut: Array<{ id: string; path: string }> = [];

    // Read everything first; the index is rewritten in one transaction below.
    const sidecars = new Map<string, SidecarIndex>();
    for await (const doc of this.fs.walk()) {
      report.scanned += 1;
      const projectId = doc.path.split('/')[0] ?? '';
      if (!this.ensureProjectForIndex(projectId)) {
        report.skipped.push({ path: doc.path, reason: 'invalid project folder' });
        continue;
      }
      let sidecar = sidecars.get(projectId);
      if (sidecar === undefined) {
        sidecar = await this.sidecarStore.load(projectId);
        sidecars.set(projectId, sidecar);
      }
      const indexed = metadataForIndex(doc, projectId, sidecar);
      const id = indexed.frontmatter.id;
      const other = kept.get(id)?.doc.path;
      if (other !== undefined) {
        if (this.preferredCopy(other, doc.path) === other) {
          leftOut.push({ id, path: doc.path });
          continue;
        }
        leftOut.push({ id, path: other });
      }
      kept.set(id, { doc, projectId, indexed });
      report.inserted += 1;
    }
    this.coordinator.transaction(() => {
      this.documentsRepo.truncate();
      this.linkService.truncate();
      this.tagsService.truncate();
      for (const { doc, projectId, indexed } of kept.values()) {
        this.indexDocument(doc, projectId, indexed);
      }
    });
    report.duplicates = leftOut.map(({ id, path }) => ({
      id,
      path,
      keptPath: kept.get(id)!.doc.path,
    }));
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
    try {
      return await this.coordinator.command({
        locate: () => ({ projects: [projectId] }),
        run: () => this.syncProjectHeld(projectId),
      });
    } finally {
      this.inFlight.delete(projectId);
    }
  }

  /**
   * `runProject` for a caller already holding the project's queue or the
   * gate exclusively (startup).
   */
  async syncProjectHeld(projectId: string): Promise<ReloadReport> {
    const started = Date.now();
    const report: ReloadReport = {
      projectId,
      added: 0,
      updated: 0,
      removed: 0,
      skipped: [],
      durationMs: 0,
      removedIds: [],
      duplicates: [],
    };

    // Snapshot what we already have on disk-of-record.
    const existing = new Map(
      this.documentsRepo.listByProject(projectId).map((d) => [d.id, d] as const),
    );
    const sidecar = await this.sidecarStore.load(projectId);

    // Read the project first; the index changes are applied in one
    // transaction below. `chosen` is the copy picked so far for each id.
    const chosen = new Map<string, { doc: RawDocument; indexed: IndexedMetadata }>();
    for await (const doc of this.fs.walkProject(projectId)) {
      const indexed = metadataForIndex(doc, projectId, sidecar);
      const id = indexed.frontmatter.id;
      const wasPresent = existing.has(id);
      existing.delete(id);
      const other = chosen.get(id)?.doc.path ?? (await this.otherIndexedCopy(id, doc.path));
      if (other !== null) {
        if (this.preferredCopy(other, doc.path) === other) {
          report.duplicates.push({ id, path: doc.path, keptPath: other });
          continue;
        }
        report.duplicates.push({ id, path: other, keptPath: doc.path });
      }
      chosen.set(id, { doc, indexed });
      if (wasPresent) report.updated += 1;
      else report.added += 1;
    }

    this.coordinator.transaction(() => {
      for (const { doc, indexed } of chosen.values()) this.indexDocument(doc, projectId, indexed);
      // Anything still in `existing` lost its backing file → purge.
      for (const [id] of existing) {
        this.documentsRepo.delete(id);
        this.linkService.onDocumentDeleted(id);
        report.removedIds.push(id);
        report.removed += 1;
      }
    });

    // Documents/links/tags for this project changed → drop its graph cache so
    // GET /:id/graph rebuilds instead of serving a stale (TTL-cached) payload.
    // (The coordinator does this after a Reload too; startup calls this
    // outside any command.)
    this.graphService.invalidate(projectId);

    report.durationMs = Date.now() - started;
    return report;
  }

  private indexDocument(doc: RawDocument, projectId: string, indexed: IndexedMetadata): void {
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
      revision: indexed.revision,
      task_state: storedTaskState(indexed.frontmatter.task_state),
    });
    this.linkService.rebuildForDocument(
      indexed.frontmatter.id,
      indexed.frontmatter.title,
      doc.body,
    );
    this.tagsService.rebuildForDocument(indexed.frontmatter.id, indexed.frontmatter.tags);
  }

  /**
   * The path of a different file already indexed under `id` that still exists
   * and still carries that id, or `null`. A row whose file is gone or changed
   * is simply superseded.
   */
  private async otherIndexedCopy(id: string, docPath: string): Promise<string | null> {
    const row = this.documentsRepo.find(id);
    if (!row || row.path === docPath) return null;
    try {
      const raw = await this.fs.read(row.path);
      return raw.frontmatter.id === id ? row.path : null;
    } catch {
      return null;
    }
  }

  /**
   * Which of two files with one id to index. Both copies of an interrupted
   * filing are self-consistent, so the choice is by place: the copy outside
   * the designated Inbox (filing's target) wins; otherwise the
   * lexicographically first path.
   */
  private preferredCopy(a: string, b: string): string {
    const inboxId = this.inbox.id();
    const inInbox = (p: string): boolean => inboxId !== null && p.startsWith(`${inboxId}/`);
    if (inInbox(a) !== inInbox(b)) return inInbox(a) ? b : a;
    return a < b ? a : b;
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
  revision: string;
}

function metadataForIndex(
  doc: RawDocument,
  projectId: string,
  sidecar: SidecarIndex,
): IndexedMetadata {
  const parsed = FrontmatterSchema.safeParse(doc.frontmatter);
  if (parsed.success) {
    if (parsed.data.project === projectId) {
      return { frontmatter: parsed.data, readOnly: false, revision: doc.revision };
    }
    return {
      frontmatter: repairMismatchedFrontmatter(doc, projectId, parsed.data),
      readOnly: true,
      revision: doc.revision,
    };
  }

  // No valid Backlogger frontmatter. A sidecar entry (sidecar-mode projects)
  // makes the file editable without writing frontmatter into the source file.
  const entry = sidecar.entries[sidecarKey(projectId, doc.path)];
  if (entry) {
    return {
      frontmatter: frontmatterFromSidecar(doc, projectId, entry),
      readOnly: false,
      revision: sidecarRevision(doc.revision, entry),
    };
  }

  return { frontmatter: deriveFrontmatter(doc, projectId), readOnly: true, revision: doc.revision };
}

/** Sidecar key for a document: its project-relative path without the project id. */
function sidecarKey(projectId: string, docPath: string): string {
  const prefix = `${projectId}/`;
  return docPath.startsWith(prefix) ? docPath.slice(prefix.length) : docPath;
}

function frontmatterFromSidecar(
  doc: RawDocument,
  projectId: string,
  entry: SidecarEntry,
): Frontmatter {
  return {
    id: entry.id,
    title: entry.title ?? deriveTitle(doc.path, doc.body),
    project: projectId,
    type: entry.type,
    status: entry.status,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    tags: entry.tags,
  };
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
