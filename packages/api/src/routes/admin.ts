import { Router } from 'express';
import type { ReindexService } from '../services/reindex-service.js';
import type { TemplateRegistry } from '../templates/registry.js';
import { loadAllTemplates } from '../templates/registry.js';

export interface AdminRouterOptions {
  reindex: ReindexService;
  templates?: TemplateRegistry;
  builtinTemplatesDir?: string;
  userTemplatesDir?: string;
}

export function adminRouter(opts: AdminRouterOptions): Router {
  const router = Router();

  router.post('/reindex', async (_req, res, next) => {
    try {
      const report = await opts.reindex.run();
      res.json(report);
    } catch (err) {
      next(err);
    }
  });

  router.post('/reload-templates', async (_req, res, next) => {
    try {
      if (!opts.templates || !opts.builtinTemplatesDir || !opts.userTemplatesDir) {
        res.status(501).json({ error: { code: 'NOT_CONFIGURED', message: 'Template reload not configured' } });
        return;
      }
      const result = await loadAllTemplates(opts.builtinTemplatesDir, opts.userTemplatesDir);
      opts.templates.setAll(result.loaded);
      res.json({ loaded: result.loaded.length, skipped: result.skipped });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
