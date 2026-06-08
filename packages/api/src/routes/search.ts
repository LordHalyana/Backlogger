import { Router } from 'express';
import { SearchRequestSchema } from '@backlogger/shared';
import { asyncRoute, validateBody } from './util.js';
import type { SearchService } from '../services/search-service.js';

export function searchRouter(service: SearchService): Router {
  const router = Router();

  router.get(
    '/',
    asyncRoute(async (req, res) => {
      const { q, projectId, limit } = validateBody(SearchRequestSchema, {
        q: req.query.q,
        projectId: req.query.projectId,
        limit: req.query.limit,
      });
      const hits = service.search(q, { projectId, limit });
      res.json(hits);
    }),
  );

  return router;
}
