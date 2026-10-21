import express, { type Express } from 'express';
import cors, { type CorsOptions } from 'cors';
import type { AppContext } from './context.js';
import { errorMiddleware } from './error-middleware.js';
import { HEALTH_JSON_SCHEMA } from './health/schema.js';
import { adminRouter } from './routes/admin.js';
import { captureRouter } from './routes/capture.js';
import { currentWorkRouter } from './routes/current-work.js';
import { projectBoardRouter } from './routes/project-board.js';
import { documentsRouter, projectDocumentsRouter } from './routes/documents.js';
import { importRouter } from './routes/import.js';
import { projectFoldersRouter } from './routes/project-folders.js';
import { projectGraphRouter } from './routes/project-graph.js';
import { projectReloadRouter } from './routes/project-reload.js';
import { projectTitlesRouter } from './routes/project-titles.js';
import { projectsRouter } from './routes/projects.js';
import { searchRouter } from './routes/search.js';
import { tagsRouter } from './routes/tags.js';
import { templatesRouter } from './routes/templates.js';

export interface CreateAppOptions {
  /**
   * Allowed CORS origins. Use `'*'` (or pass an array containing `'*'`) to
   * reflect any origin (useful for self-hosted LAN access). Omit or pass an
   * empty array to disable CORS entirely (same-origin only).
   */
  allowedOrigins?: string[] | '*';
}

export function createApp(ctx: AppContext, options: CreateAppOptions = {}): Express {
  const app = express();

  const corsMw = corsMiddlewareFor(options.allowedOrigins);
  if (corsMw) app.use(corsMw);

  app.use(express.json({ limit: '24mb' }));

  app.get('/health', (_req, res) => {
    const payload = ctx.healthService.snapshot();
    const code = payload.status === 'error' ? 503 : 200;
    res.status(code).json(payload);
  });

  app.get('/health/schema', (_req, res) => {
    res
      .type('application/schema+json')
      .set('Cache-Control', 'public, max-age=3600')
      .json(HEALTH_JSON_SCHEMA);
  });

  app.use('/api/projects', projectTitlesRouter(ctx.linkService));
  app.use('/api/projects', projectReloadRouter(ctx.projectService, ctx.reindexService));
  app.use('/api/projects', projectFoldersRouter(ctx.projectService, ctx.fs, ctx.coordinator));
  app.use('/api/projects', projectGraphRouter(ctx.graphService));
  app.use('/api/projects', projectBoardRouter(ctx.boardService));
  app.use('/api/projects', projectsRouter(ctx.projectService));
  app.use('/api/projects/:projectId/documents', projectDocumentsRouter(ctx.documentService));
  app.use('/api/projects/:projectId/import', importRouter(ctx.importService));
  app.use('/api/capture', captureRouter(ctx.documentService));
  app.use('/api/current-work', currentWorkRouter(ctx.currentWorkService));
  app.use('/api/documents', documentsRouter(ctx.documentService, ctx.linkService));
  app.use('/api/search', searchRouter(ctx.searchService));
  app.use('/api/tags', tagsRouter(ctx.tagsService));
  app.use('/api/templates', templatesRouter(ctx.templates));
  app.use('/api/admin', adminRouter({
    reindex: ctx.reindexService,
    templates: ctx.templates,
    builtinTemplatesDir: ctx.builtinTemplatesDir,
    userTemplatesDir: ctx.userTemplatesDir,
  }));

  app.use(errorMiddleware);
  return app;
}

function corsMiddlewareFor(
  allowed: string[] | '*' | undefined,
): ReturnType<typeof cors> | null {
  if (!allowed || (Array.isArray(allowed) && allowed.length === 0)) return null;

  const reflectAny =
    allowed === '*' || (Array.isArray(allowed) && allowed.includes('*'));

  const opts: CorsOptions = {
    origin: reflectAny
      ? true
      : (origin, cb) => {
          // Same-origin / curl requests have no Origin header — always allow.
          if (!origin) return cb(null, true);
          const list = allowed as string[];
          cb(null, list.includes(origin));
        },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'If-Match'],
    exposedHeaders: ['ETag'],
  };

  return cors(opts);
}
