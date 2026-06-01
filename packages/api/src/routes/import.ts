import { Router, type NextFunction, type Request, type Response } from 'express';
import { ImportRequestSchema, ProjectIdSchema } from '@backlogger/shared';
import { BadRequestError } from '../errors.js';
import type { ImportService } from '../services/import-service.js';

/** Mounted at /api/projects/:projectId/import */
export function importRouter(service: ImportService): Router {
  const router = Router({ mergeParams: true });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = parseProjectId((req.params as { projectId?: string }).projectId);
      const parsed = ImportRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new BadRequestError(
          'VALIDATION_FAILED',
          'Invalid import request',
          parsed.error.format(),
        );
      }
      const result = await service.importFiles(projectId, parsed.data.files, parsed.data.placement);
      const status = result.errors.length > 0 ? 207 : 200;
      res.status(status).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function parseProjectId(raw: unknown): string {
  const parsed = ProjectIdSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestError('INVALID_PROJECT_ID', 'Invalid project id', parsed.error.format());
  }
  return parsed.data;
}
