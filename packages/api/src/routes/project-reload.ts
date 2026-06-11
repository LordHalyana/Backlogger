import { Router } from 'express';
import { ConflictError } from '../errors.js';
import type { ProjectService } from '../services/project-service.js';
import { ReloadInProgressError, type ReindexService } from '../services/reindex-service.js';
import { asyncRoute } from './util.js';
import { parseProjectId } from './route-params.js';

export function projectReloadRouter(
  projectService: ProjectService,
  reindexService: ReindexService,
): Router {
  const router = Router();

  router.post(
    '/:id/reload',
    asyncRoute(async (req, res) => {
      const id = parseProjectId(req.params.id);
      // 404 if the project is unknown (mirrors GET /:id behavior).
      projectService.get(id);
      try {
        const report = await reindexService.runProject(id);
        res.json(report);
      } catch (err) {
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

  return router;
}
