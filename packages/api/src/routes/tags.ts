import { Router } from 'express';
import { ProjectIdSchema, TagSchema } from '@backlogger/shared';
import { BadRequestError } from '../errors.js';
import type { TagsService } from '../services/tags-service.js';

export function tagsRouter(service: TagsService): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    try {
      const raw = req.query.projectId;
      let projectId: string | undefined;
      if (raw !== undefined) {
        const parsed = ProjectIdSchema.safeParse(raw);
        if (!parsed.success) {
          throw new BadRequestError(
            'INVALID_PROJECT_ID',
            `Invalid project id: ${String(raw)}`,
          );
        }
        projectId = parsed.data;
      }
      res.json(service.list(projectId));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** Parse and normalize an array of raw tag query-param values. */
export function parseTagParams(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((t, i) => {
    const parsed = TagSchema.safeParse(String(t));
    if (!parsed.success) {
      throw new BadRequestError('INVALID_TAG', `Invalid tag at position ${i}: ${String(t)}`);
    }
    return parsed.data;
  });
}
