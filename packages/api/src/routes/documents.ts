import { Router } from 'express';
import {
  CreateDocumentRequestSchema,
  FileDocumentRequestSchema,
  MoveDocumentRequestSchema,
  UpdateDocumentRequestSchema,
} from '@backlogger/shared';
import { asyncRoute, validateBody } from './util.js';
import type { DocumentService } from '../services/document-service.js';
import type { LinkService } from '../services/link-service.js';
import { parseTagParams } from './tags.js';
import { parseDocumentId, parseProjectId } from './route-params.js';

/** Routes mounted at /api/projects/:projectId/documents */
export function projectDocumentsRouter(service: DocumentService): Router {
  const router = Router({ mergeParams: true });

  router.get(
    '/',
    asyncRoute(async (req, res) => {
      const projectId = parseProjectId((req.params as { projectId?: string }).projectId);
      const tags = parseTagParams(req.query.tag);
      if (tags.length > 0) {
        res.json(service.listByProjectAndTags(projectId, tags));
      } else {
        res.json(service.listByProject(projectId));
      }
    }),
  );

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const projectId = parseProjectId((req.params as { projectId?: string }).projectId);
      const input = validateBody(CreateDocumentRequestSchema, req.body);
      const doc = await service.create(projectId, input);
      res.status(201).json(doc);
    }),
  );

  return router;
}

/** Routes mounted at /api/documents */
export function documentsRouter(
  service: DocumentService,
  linkService: LinkService,
): Router {
  const router = Router();

  router.get(
    '/:id',
    asyncRoute(async (req, res) => {
      const id = parseDocumentId(req.params.id);
      res.json(await service.get(id));
    }),
  );

  router.get(
    '/:id/backlinks',
    asyncRoute(async (req, res) => {
      const id = parseDocumentId(req.params.id);
      const rows = linkService.backlinksFor(id);
      res.json(rows);
    }),
  );

  router.get(
    '/:id/raw',
    asyncRoute(async (req, res, next) => {
      const id = parseDocumentId(req.params.id);
      const { absolutePath, diskFilename, title } = await service.locateRaw(id);
      // Use the (already-safe) on-disk filename for the ASCII fallback and
      // the human-readable title in `filename*` per RFC 5987.
      const titleSafe = encodeURIComponent(`${title}.md`);
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${diskFilename}"; filename*=UTF-8''${titleSafe}`,
      );
      res.setHeader('Cache-Control', 'private, no-store');
      res.sendFile(absolutePath, (err) => {
        if (err) next(err);
      });
    }),
  );

  router.put(
    '/:id',
    asyncRoute(async (req, res) => {
      const id = parseDocumentId(req.params.id);
      const input = validateBody(UpdateDocumentRequestSchema, req.body);
      const ifMatch = req.header('If-Match');
      const doc = await service.update(id, input, ifMatch);
      res.json(doc);
    }),
  );

  router.delete(
    '/:id',
    asyncRoute(async (req, res) => {
      const id = parseDocumentId(req.params.id);
      res.json(
        await service.delete({ operationId: req.header('Idempotency-Key'), documentId: id }),
      );
    }),
  );

  router.post(
    '/:id/file',
    asyncRoute(async (req, res) => {
      const id = parseDocumentId(req.params.id);
      const { target_project_id, revision } = validateBody(FileDocumentRequestSchema, req.body);
      res.json(
        await service.file({
          operationId: req.header('Idempotency-Key'),
          documentId: id,
          targetProjectId: target_project_id,
          revision,
        }),
      );
    }),
  );

  router.post(
    '/:id/move',
    asyncRoute(async (req, res) => {
      const id = parseDocumentId(req.params.id);
      const { folder } = validateBody(MoveDocumentRequestSchema, req.body);
      const doc = await service.move(id, folder);
      res.json(doc);
    }),
  );

  return router;
}
