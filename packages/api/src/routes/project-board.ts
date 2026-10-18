import { Router } from 'express';
import type { BoardService } from '../services/board-service.js';
import { asyncRoute } from './util.js';
import { parseProjectId } from './route-params.js';

/** Routes mounted at /api/projects */
export function projectBoardRouter(service: BoardService): Router {
  const router = Router();

  router.get(
    '/:id/board',
    asyncRoute(async (req, res) => {
      const id = parseProjectId(req.params.id);
      res.json(service.board(id));
    }),
  );

  return router;
}
