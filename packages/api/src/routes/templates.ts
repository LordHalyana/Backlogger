import { Router } from 'express';
import { NotFoundError } from '../errors.js';
import type { TemplateRegistry } from '../templates/registry.js';

export function templatesRouter(registry: TemplateRegistry): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(registry.list());
  });

  router.get('/:id', (req, res, next) => {
    try {
      const t = registry.get(req.params.id);
      if (!t) throw new NotFoundError('TEMPLATE_NOT_FOUND', `Template not found: ${req.params.id}`);
      res.json(t);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
