import { z } from 'zod';
import { DocumentTypeSchema } from './documents.js';
import { ProjectIdSchema } from './projects.js';

export const SearchHitSchema = z.object({
  id: z.string().uuid(),
  project_id: ProjectIdSchema,
  title: z.string(),
  type: DocumentTypeSchema,
  snippet: z.string(),
  rank: z.number(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SEARCH_DEFAULT_LIMIT = 50;
export const SEARCH_MAX_LIMIT = 200;

export const SearchRequestSchema = z.object({
  q: z.string().min(1).max(500),
  projectId: ProjectIdSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SEARCH_MAX_LIMIT)
    .default(SEARCH_DEFAULT_LIMIT),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;
