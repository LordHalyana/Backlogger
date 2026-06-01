import { Router } from 'express';
import { SearchRequestSchema } from '@backlogger/shared';
import { BadRequestError } from '../errors.js';
import type { SearchService } from '../services/search-service.js';

export function searchRouter(service: SearchService): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    try {
      const parsed = SearchRequestSchema.safeParse({
        q: req.query.q,
        projectId: req.query.projectId,
        limit: req.query.limit,
      });
      if (!parsed.success) {
        throw new BadRequestError(
          'VALIDATION_FAILED',
          'Invalid search request',
          parsed.error.format(),
        );
      }
      const { q, projectId, limit } = parsed.data;
      const hits = service.search(q, { projectId, limit });
      res.json(hits);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
