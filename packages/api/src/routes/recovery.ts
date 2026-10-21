import { Router } from 'express';
import type { RecoveryService } from '../services/recovery-service.js';
import { asyncRoute } from './util.js';

/** Routes mounted at /api/recovery. */
export function recoveryRouter(service: RecoveryService): Router {
  const router = Router();

  router.get(
    '/',
    asyncRoute(async (_req, res) => {
      res.json(await service.list());
    }),
  );

  router.get(
    '/:operationId',
    asyncRoute(async (req, res) => {
      res.json(await service.detail(req.params.operationId ?? ''));
    }),
  );

  router.post(
    '/:operationId/recheck',
    asyncRoute(async (req, res) => {
      res.json(await service.recheck(req.params.operationId ?? ''));
    }),
  );

  router.post(
    '/:operationId/abandon',
    asyncRoute(async (req, res) => {
      const input = (req.body ?? {}) as { review_token?: unknown };
      res.json(
        await service.abandon({
          operationId: req.header('Idempotency-Key'),
          targetOperationId: req.params.operationId ?? '',
          reviewToken: input.review_token,
        }),
      );
    }),
  );

  return router;
}
