import { Router } from 'express';
import type { CommentService } from '../services/comment-service.js';
import { asyncRoute } from './util.js';
import { parseDocumentId } from './route-params.js';

/** Routes mounted at /api/documents: a task's comments. */
export function taskCommentsRouter(service: CommentService): Router {
  const router = Router();

  router.get(
    '/:taskId/comments',
    asyncRoute(async (req, res) => {
      const taskId = parseDocumentId(req.params.taskId);
      const { cursor, after, around, limit } = req.query;
      res.json(service.list(taskId, { cursor, after, around, limit }));
    }),
  );

  router.post(
    '/:taskId/comments',
    asyncRoute(async (req, res) => {
      const taskId = parseDocumentId(req.params.taskId);
      const input = (req.body ?? {}) as { id?: unknown; body?: unknown };
      const ack = await service.create({
        operationId: req.header('Idempotency-Key'),
        taskId,
        commentId: input.id,
        body: input.body,
      });
      res.status(201).json(ack);
    }),
  );

  return router;
}

/** Routes mounted at /api/comments. */
export function commentsRouter(service: CommentService): Router {
  const router = Router();

  router.get(
    '/:commentId',
    asyncRoute(async (req, res) => {
      res.json(await service.get(req.params.commentId ?? ''));
    }),
  );

  router.put(
    '/:commentId',
    asyncRoute(async (req, res) => {
      const input = (req.body ?? {}) as { body?: unknown };
      res.json(
        await service.edit({
          operationId: req.header('Idempotency-Key'),
          commentId: req.params.commentId ?? '',
          expectedRevision: req.header('If-Match'),
          body: input.body,
        }),
      );
    }),
  );

  router.delete(
    '/:commentId',
    asyncRoute(async (req, res) => {
      res.json(
        await service.delete({
          operationId: req.header('Idempotency-Key'),
          commentId: req.params.commentId ?? '',
          expectedRevision: req.header('If-Match'),
        }),
      );
    }),
  );

  return router;
}
