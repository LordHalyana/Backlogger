import { Router } from 'express';
import {
  CreateProjectRequestSchema,
  FolderPathSchema,
  ProjectIdSchema,
  UpdateProjectRequestSchema,
} from '@backlogger/shared';
import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';
import { asyncRoute, validateBody } from './util.js';
import type { ProjectService } from '../services/project-service.js';
import type { LinkService } from '../services/link-service.js';
import { ReloadInProgressError, type ReindexService } from '../services/reindex-service.js';
import type { FsRepository } from '../fs/index.js';
import type { GraphService } from '../services/graph-service.js';

export function projectsRouter(
  service: ProjectService,
  linkService: LinkService,
  reindexService: ReindexService,
  fs: FsRepository,
  graphService: GraphService,
): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(service.list());
  });

  router.get('/:id', (req, res) => {
    const id = parseId(req.params.id);
    res.json(service.get(id));
  });

  router.get(
    '/:id/titles',
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id);
      const rows = linkService.titles(id);
      res.json(rows);
    }),
  );

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const input = validateBody(CreateProjectRequestSchema, req.body);
      const project = await service.create(input);
      res.status(201).json(project);
    }),
  );

  router.put(
    '/:id',
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id);
      const input = validateBody(UpdateProjectRequestSchema, req.body);
      res.json(service.update(id, input));
    }),
  );

  router.delete(
    '/:id',
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id);
      await service.delete(id);
      res.status(204).send();
    }),
  );

  router.post(
    '/:id/reload',
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id);
      // 404 if the project is unknown (mirrors GET /:id behavior).
      service.get(id);
      try {
        const report = await reindexService.runProject(id);
        res.json(report);
      } catch (err) {
        // Translate the concurrency guard into a 409 for the client.
        if (err instanceof ReloadInProgressError) {
          throw new ConflictError(
            'RELOAD_IN_PROGRESS',
            `Reload already in progress for project: ${err.projectId}`,
          );
        }
        throw err;
      }
    }),
  );

  // ----- Folder management ----------------------------------------------

  router.get(
    '/:id/folders',
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id);
      service.get(id); // 404 if unknown
      const folders = await fs.listFolders(id);
      res.json(folders);
    }),
  );

  router.post(
    '/:id/folders',
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id);
      service.get(id);
      const body = req.body as { folder?: unknown } | undefined;
      const folder = await fs.createFolder(id, validateBody(FolderPathSchema, body?.folder));
      res.status(201).json({ folder });
    }),
  );

  // See docs/design/folder-invariants.md for the rules governing folder deletion.
  router.delete(
    '/:id/folders/*',
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id);
      service.get(id);
      // Express captures the wildcard rest in params[0].
      const raw = (req.params as { 0?: string })[0] ?? '';
      const folder = validateBody(FolderPathSchema, decodeURIComponent(raw));
      // Refuse to remove a non-empty folder (any files anywhere under it).
      const existing = await fs.listFolders(id);
      if (!existing.includes(folder)) {
        throw new NotFoundError('FOLDER_NOT_FOUND', `Folder not found: ${folder}`);
      }
      const files = await fs.listProjectFiles(id);
      const prefix = `${id}/${folder}/`;
      const occupied = files.some((p) => p.startsWith(prefix));
      const hasSubfolder = existing.some((f) => f.startsWith(`${folder}/`));
      if (occupied || hasSubfolder) {
        throw new ConflictError('FOLDER_NOT_EMPTY', `Folder not empty: ${folder}`);
      }
      await fs.removeFolder(id, folder);
      res.status(204).send();
    }),
  );

  router.get(
    '/:id/graph',
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id);
      const payload = graphService.getGraph(id);
      res.json(payload);
    }),
  );

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
