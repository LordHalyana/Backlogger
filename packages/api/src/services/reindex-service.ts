import { FrontmatterSchema } from '@backlogger/shared';
import type { DocumentsRepo } from '../db/documents-repo.js';
import type { ProjectsRepo } from '../db/projects-repo.js';
import type { FsRepository } from '../fs/index.js';
import type { LinkService } from './link-service.js';
import type { TagsService } from './tags-service.js';

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
  linkService?: LinkService;
  tagsService?: TagsService;
}

/**
 * Walks `<dataDir>/projects/` and rebuilds the `documents` table from
 * the frontmatter found on disk. Files with invalid or missing frontmatter
 * are skipped and reported.
 */
export class ReindexService {
  private readonly documentsRepo: DocumentsRepo;
  private readonly projectsRepo: ProjectsRepo;
  private readonly fs: FsRepository;
  private readonly linkService: LinkService | undefined;
  private readonly tagsService: TagsService | undefined;
  private readonly inFlight = new Set<string>();

  constructor(deps: ReindexServiceDeps) {
    this.documentsRepo = deps.documentsRepo;
    this.projectsRepo = deps.projectsRepo;
    this.fs = deps.fs;
    this.linkService = deps.linkService;
    this.tagsService = deps.tagsService;
  }

  async run(): Promise<ReindexReport> {
    const report: ReindexReport = { scanned: 0, inserted: 0, skipped: [] };
    this.documentsRepo.truncate();
    this.linkService?.truncate();
    this.tagsService?.truncate();

    for await (const doc of this.fs.walk()) {
      report.scanned += 1;
      const projectId = doc.path.split('/')[0] ?? '';
      if (!this.projectsRepo.exists(projectId)) {
        report.skipped.push({ path: doc.path, reason: 'unknown project' });
        continue;
      }
      const parsed = FrontmatterSchema.safeParse(doc.frontmatter);
      if (!parsed.success) {
        report.skipped.push({ path: doc.path, reason: 'invalid frontmatter' });
        continue;
      }
      const fm = parsed.data;
      if (fm.project !== projectId) {
        report.skipped.push({ path: doc.path, reason: 'project/folder mismatch' });
        continue;
      }
      this.documentsRepo.upsert({
        id: fm.id,
        project_id: projectId,
        title: fm.title,
        type: fm.type,
        status: fm.status,
        path: doc.path,
        tags: fm.tags,
        body: doc.body,
        created_at: fm.created_at,
        updated_at: fm.updated_at,
      });
      this.linkService?.rebuildForDocument(fm.id, fm.title, doc.body);
      this.tagsService?.rebuildForDocument(fm.id, fm.tags);
      report.inserted += 1;
    }
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
        const parsed = FrontmatterSchema.safeParse(doc.frontmatter);
        if (!parsed.success) {
          report.skipped.push({ path: doc.path, reason: 'invalid frontmatter' });
          continue;
        }
        const fm = parsed.data;
        if (fm.project !== projectId) {
          report.skipped.push({ path: doc.path, reason: 'project/folder mismatch' });
          continue;
        }
        const wasPresent = existing.has(fm.id);
        this.documentsRepo.upsert({
          id: fm.id,
          project_id: projectId,
          title: fm.title,
          type: fm.type,
          status: fm.status,
          path: doc.path,
          tags: fm.tags,
          body: doc.body,
          created_at: fm.created_at,
          updated_at: fm.updated_at,
        });
        this.linkService?.rebuildForDocument(fm.id, fm.title, doc.body);
        this.tagsService?.rebuildForDocument(fm.id, fm.tags);
        if (wasPresent) report.updated += 1;
        else report.added += 1;
        existing.delete(fm.id);
      }

      // Anything still in `existing` lost its backing file → purge.
      for (const [id] of existing) {
        this.documentsRepo.delete(id);
        this.linkService?.onDocumentDeleted(id);
        report.removedIds.push(id);
        report.removed += 1;
      }

      report.durationMs = Date.now() - started;
      return report;
    } finally {
      this.inFlight.delete(projectId);
    }
  }
}
