import { Router } from 'express';
import type { GraphService } from '../services/graph-service.js';
import { asyncRoute } from './util.js';
import { parseProjectId } from './route-params.js';

export function projectGraphRouter(graphService: GraphService): Router {
  const router = Router();

  router.get(
    '/:id/graph',
    asyncRoute(async (req, res) => {
      const id = parseProjectId(req.params.id);
      const payload = graphService.getGraph(id);
      res.json(payload);
    }),
  );

  return router;
}
