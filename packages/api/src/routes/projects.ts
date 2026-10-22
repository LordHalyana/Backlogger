import { Router } from 'express';
import {
  CreateProjectRequestSchema,
  UpdateProjectRequestSchema,
} from '@backlogger/shared';
import { asyncRoute, validateBody } from './util.js';
import type { ProjectService } from '../services/project-service.js';
import { parseProjectId } from './route-params.js';

export function projectsRouter(service: ProjectService): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(service.list());
  });

  router.get('/:id', (req, res) => {
    const id = parseProjectId(req.params.id);
    res.json(service.get(id));
  });

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const input = validateBody(CreateProjectRequestSchema, req.body);
      const project = await service.create(input);
      res.status(201).json(project);
    }),
  );

  router.put(
    '/:id',
    asyncRoute(async (req, res) => {
      const id = parseProjectId(req.params.id);
      const input = validateBody(UpdateProjectRequestSchema, req.body);
      res.json(await service.update(id, input));
    }),
  );

  router.delete(
    '/:id',
    asyncRoute(async (req, res) => {
      const id = parseProjectId(req.params.id);
      res.json(await service.delete({ operationId: req.header('Idempotency-Key'), projectId: id }));
    }),
  );

  return router;
}

// Type-only re-export to keep router signature explicit for error middleware.
export type { Request, Response };
