import { Router } from 'express';
import { ImportRequestSchema, ProjectIdSchema } from '@backlogger/shared';
import { BadRequestError } from '../errors.js';
import { asyncRoute, validateBody } from './util.js';
import type { ImportService } from '../services/import-service.js';

/** Mounted at /api/projects/:projectId/import */
export function importRouter(service: ImportService): Router {
  const router = Router({ mergeParams: true });

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const projectId = parseProjectId((req.params as { projectId?: string }).projectId);
      const { files, placement } = validateBody(ImportRequestSchema, req.body);
      const result = await service.importFiles(projectId, files, placement);
      const status = result.errors.length > 0 ? 207 : 200;
      res.status(status).json(result);
    }),
  );

  return router;
}

function parseProjectId(raw: unknown): string {
  const parsed = ProjectIdSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestError('INVALID_PROJECT_ID', 'Invalid project id', parsed.error.format());
  }
  return parsed.data;
}
