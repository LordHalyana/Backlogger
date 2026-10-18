import { Router } from 'express';
import type { CurrentWorkService } from '../services/current-work-service.js';

/** Routes mounted at /api/current-work */
export function currentWorkRouter(service: CurrentWorkService): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(service.read());
  });

  return router;
}
