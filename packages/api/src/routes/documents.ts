import { Router } from 'express';
import {
  CreateDocumentRequestSchema,
  ProjectIdSchema,
  UpdateDocumentRequestSchema,
} from '@backlogger/shared';
import { BadRequestError } from '../errors.js';
import type { DocumentService } from '../services/document-service.js';
import type { LinkService } from '../services/link-service.js';
import { parseTagParams } from './tags.js';

function parseProjectId(raw: unknown): string {
  const parsed = ProjectIdSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestError('INVALID_PROJECT_ID', `Invalid project id: ${String(raw)}`);
  }
  return parsed.data;
}

function parseDocId(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[0-9a-f-]{36}$/.test(raw)) {
    throw new BadRequestError('INVALID_DOCUMENT_ID', `Invalid document id: ${String(raw)}`);
  }
  return raw;
}

/** Routes mounted at /api/projects/:projectId/documents */
export function projectDocumentsRouter(service: DocumentService): Router {
  const router = Router({ mergeParams: true });

  router.get('/', (req, res, next) => {
    try {
      const projectId = parseProjectId((req.params as { projectId?: string }).projectId);
      const tags = parseTagParams(req.query.tag);
      if (tags.length > 0) {
        res.json(service.listByProjectAndTags(projectId, tags));
      } else {
        res.json(service.listByProject(projectId));
      }
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const projectId = parseProjectId((req.params as { projectId?: string }).projectId);
      const parsed = CreateDocumentRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new BadRequestError(
          'VALIDATION_FAILED',
          'Invalid request body',
          parsed.error.format(),
        );
      }
      const doc = await service.create(projectId, parsed.data);
      res.status(201).json(doc);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** Routes mounted at /api/documents */
export function documentsRouter(
  service: DocumentService,
  linkService?: LinkService,
): Router {
  const router = Router();

  router.get('/:id', async (req, res, next) => {
    try {
      const id = parseDocId(req.params.id);
      res.json(await service.get(id));
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/backlinks', (req, res, next) => {
    try {
      const id = parseDocId(req.params.id);
      const rows = linkService?.backlinksFor(id) ?? [];
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/raw', async (req, res, next) => {
    try {
      const id = parseDocId(req.params.id);
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
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const id = parseDocId(req.params.id);
      const parsed = UpdateDocumentRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new BadRequestError(
          'VALIDATION_FAILED',
          'Invalid request body',
          parsed.error.format(),
        );
      }
      const ifMatch = req.header('If-Match');
      const doc = await service.update(id, parsed.data, ifMatch);
      res.json(doc);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const id = parseDocId(req.params.id);
      await service.delete(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
