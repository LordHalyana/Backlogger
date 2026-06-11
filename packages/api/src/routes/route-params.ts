import { ProjectIdSchema } from '@backlogger/shared';
import { BadRequestError } from '../errors.js';

export function parseProjectId(raw: unknown): string {
  const parsed = ProjectIdSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestError('INVALID_PROJECT_ID', `Invalid project id: ${String(raw)}`);
  }
  return parsed.data;
}

export function parseDocumentId(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[0-9a-f-]{36}$/.test(raw)) {
    throw new BadRequestError('INVALID_DOCUMENT_ID', `Invalid document id: ${String(raw)}`);
  }
  return raw;
}
