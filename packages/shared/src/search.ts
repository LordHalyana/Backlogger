import { z } from 'zod';
import { DocumentStatusSchema, DocumentTypeSchema } from './documents.js';
import { ProjectIdSchema } from './projects.js';

/**
 * Which record of a result's document matched (spec #58): the document
 * itself (title, tags, body), shown as a Description match, or one comment
 * on it, shown as a Comment match. A task with several matching records is
 * one result labelled with the strongest of them.
 */
export const SearchMatchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('description') }),
  z.object({
    kind: z.literal('comment'),
    comment_id: z.string().uuid(),
    created_at: z.string(),
  }),
]);
export type SearchMatch = z.infer<typeof SearchMatchSchema>;

export const SearchHitSchema = z.object({
  /** The document (for a comment match, its parent task). */
  id: z.string().uuid(),
  project_id: ProjectIdSchema,
  title: z.string(),
  type: DocumentTypeSchema,
  status: DocumentStatusSchema,
  /** Frontmatter `task_state`, verbatim; `null` when absent. */
  task_state: z.string().nullable(),
  match: SearchMatchSchema,
  /** One excerpt of the matching record, without markup. */
  snippet: z.string(),
  /** `[start, end)` offsets into `snippet` of the matched terms, in order. */
  highlights: z.array(z.tuple([z.number().int(), z.number().int()])),
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
