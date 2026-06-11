import type { ErrorRequestHandler } from 'express';
import type { ApiErrorBody } from '@backlogger/shared';
import { HttpError } from './errors.js';
import { FsRepoError } from './fs/index.js';
import { logger } from './logger.js';

const FS_TO_HTTP: Record<string, number> = {
  PATH_OUTSIDE_DATA_DIR: 400,
  INVALID_PROJECT_ID: 400,
  INVALID_FILENAME: 400,
  INVALID_RELATIVE_PATH: 400,
  SYMLINK_NOT_ALLOWED: 400,
  DOCUMENT_NOT_FOUND: 404,
  PROJECT_NOT_FOUND: 404,
};

export const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    const body: ApiErrorBody = {
      error: { code: err.code, message: err.message, details: err.details },
    };
    res.status(err.status).json(body);
    return;
  }
  if (err instanceof FsRepoError) {
    const status = FS_TO_HTTP[err.code] ?? 500;
    const body: ApiErrorBody = { error: { code: err.code, message: err.message } };
    res.status(status).json(body);
    return;
  }
  logger.error('unhandled error', err);
  const body: ApiErrorBody = {
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  };
  res.status(500).json(body);
};
