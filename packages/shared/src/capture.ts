import { z } from 'zod';
import { ProjectIdSchema } from './projects.js';

/** A lowercase UUID v4, as clients generate for each capture attempt. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * `POST /api/capture`: create a backlog item from a title alone. The client
 * chooses the id and reuses it on Retry, which makes a resend safe.
 */
export const CaptureRequestSchema = z.object({
  id: z.string().regex(UUID_V4, { message: 'id must be a lowercase UUID v4' }),
  title: z.string().trim().min(1).max(200),
  /** Omitted → the designated Inbox. */
  project_id: ProjectIdSchema.optional(),
});
export type CaptureRequest = z.infer<typeof CaptureRequestSchema>;
