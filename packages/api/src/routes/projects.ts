import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  CreateProjectRequestSchema,
  FolderPathSchema,
  ProjectIdSchema,
  UpdateProjectRequestSchema,
} from '@backlogger/shared';
import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';
import type { ProjectService } from '../services/project-service.js';
import type { LinkService } from '../services/link-service.js';
import { ReloadInProgressError, type ReindexService } from '../services/reindex-service.js';
import type { FsRepository } from '../fs/index.js';
import type { GraphService } from '../services/graph-service.js';

export function projectsRouter(
  service: ProjectService,
  linkService?: LinkService,
  reindexService?: ReindexService,
  fs?: FsRepository,
  graphService?: GraphService,
): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(service.list());
  });

  router.get('/:id', (req, res) => {
    const id = parseId(req.params.id);
    res.json(service.get(id));
  });

  router.get('/:id/titles', (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const rows = linkService?.titles(id) ?? [];
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next: NextFunction) => {
    try {
      const parsed = CreateProjectRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new BadRequestError('VALIDATION_FAILED', 'Invalid request body', parsed.error.format());
      }
      const project = await service.create(parsed.data);
      res.status(201).json(project);
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const parsed = UpdateProjectRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new BadRequestError('VALIDATION_FAILED', 'Invalid request body', parsed.error.format());
      }
      res.json(service.update(id, parsed.data));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      await service.delete(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/reload', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      // 404 if the project is unknown (mirrors GET /:id behavior).
      service.get(id);
      if (!reindexService) {
        throw new BadRequestError('RELOAD_UNAVAILABLE', 'Reindex service not configured');
      }
      const report = await reindexService.runProject(id);
      res.json(report);
    } catch (err) {
      if (err instanceof ReloadInProgressError) {
        next(
          new ConflictError(
            'RELOAD_IN_PROGRESS',
            `Reload already in progress for project: ${err.projectId}`,
          ),
        );
        return;
      }
      next(err);
    }
  });

  // ----- Folder management ----------------------------------------------

  router.get('/:id/folders', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      service.get(id); // 404 if unknown
      if (!fs) throw new BadRequestError('FOLDERS_UNAVAILABLE', 'Filesystem repo not configured');
      const folders = await fs.listFolders(id);
      res.json(folders);
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/folders', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      service.get(id);
      if (!fs) throw new BadRequestError('FOLDERS_UNAVAILABLE', 'Filesystem repo not configured');
      const body = req.body as { folder?: unknown } | undefined;
      const parsed = FolderPathSchema.safeParse(body?.folder);
      if (!parsed.success) {
        throw new BadRequestError(
          'VALIDATION_FAILED',
          'Invalid folder path',
          parsed.error.format(),
        );
      }
      const folder = await fs.createFolder(id, parsed.data);
      res.status(201).json({ folder });
    } catch (err) {
      next(err);
    }
  });

  // See docs/design/folder-invariants.md for the rules governing folder deletion.
  router.delete('/:id/folders/*', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      service.get(id);
      if (!fs) throw new BadRequestError('FOLDERS_UNAVAILABLE', 'Filesystem repo not configured');
      // Express captures the wildcard rest in params[0].
      const raw = (req.params as { 0?: string })[0] ?? '';
      const folder = decodeURIComponent(raw);
      const parsed = FolderPathSchema.safeParse(folder);
      if (!parsed.success) {
        throw new BadRequestError('VALIDATION_FAILED', 'Invalid folder path');
      }
      // Refuse to remove a non-empty folder (any files anywhere under it).
      const existing = await fs.listFolders(id);
      if (!existing.includes(parsed.data)) {
        throw new NotFoundError('FOLDER_NOT_FOUND', `Folder not found: ${parsed.data}`);
      }
      const files = await fs.listProjectFiles(id);
      const prefix = `${id}/${parsed.data}/`;
      const occupied = files.some((p) => p.startsWith(prefix));
      const hasSubfolder = existing.some(
        (f) => f.startsWith(`${parsed.data}/`),
      );
      if (occupied || hasSubfolder) {
        throw new ConflictError(
          'FOLDER_NOT_EMPTY',
          `Folder not empty: ${parsed.data}`,
        );
      }
      await fs.removeFolder(id, parsed.data);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/graph', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!graphService) {
        res.status(503).json({ error: 'Graph service not available' });
        return;
      }
      const payload = graphService.getGraph(id);
      res.json(payload);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function parseId(raw: unknown): string {
  const parsed = ProjectIdSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestError('INVALID_PROJECT_ID', `Invalid project id: ${String(raw)}`);
  }
  return parsed.data;
}

// Type-only re-export to keep router signature explicit for error middleware.
export type { Request, Response };
