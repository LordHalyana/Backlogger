import { Router } from 'express';
import type { LinkService } from '../services/link-service.js';
import { asyncRoute } from './util.js';
import { parseProjectId } from './route-params.js';

export function projectTitlesRouter(linkService: LinkService): Router {
  const router = Router();

  router.get(
    '/:id/titles',
    asyncRoute(async (req, res) => {
      const id = parseProjectId(req.params.id);
      const rows = linkService.titles(id);
      res.json(rows);
    }),
  );

  return router;
}
