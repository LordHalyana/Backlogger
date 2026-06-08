import type { RequestHandler, Request, Response, NextFunction } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { BadRequestError } from '../errors.js';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

/**
 * Wraps an async Express handler and forwards any rejected promise to next(err),
 * eliminating the boilerplate try/catch + next(err) block from every route.
 */
export function asyncRoute(handler: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/**
 * Parses `body` against a Zod schema. Throws `BadRequestError('VALIDATION_FAILED')`
 * on failure, so callers never need to repeat the safeParse + error construction.
 *
 * Returns the schema's *output* type, so schemas using `.default()` resolve to
 * their post-parse (required) shape rather than the optional input shape.
 */
export function validateBody<S extends ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestError('VALIDATION_FAILED', 'Invalid request body', parsed.error.format());
  }
  return parsed.data;
}
