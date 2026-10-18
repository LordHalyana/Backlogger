import { Router } from 'express';
import { CaptureRequestSchema } from '@backlogger/shared';
import type { DocumentService } from '../services/document-service.js';
import { asyncRoute, validateBody } from './util.js';

/** Routes mounted at /api/capture */
export function captureRouter(service: DocumentService): Router {
  const router = Router();

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const input = validateBody(CaptureRequestSchema, req.body);
      const { document, created } = await service.capture(input);
      res.status(created ? 201 : 200).json(document);
    }),
  );

  return router;
}
