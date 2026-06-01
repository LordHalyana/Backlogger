import { z } from 'zod';
import { DocumentTypeSchema } from './documents.js';

export const TemplateIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'template id must be kebab-case');

export const TemplateSummarySchema = z.object({
  id: TemplateIdSchema,
  name: z.string().min(1).max(200),
  type: DocumentTypeSchema,
  source: z.enum(['builtin', 'user']).default('builtin'),
});
export type TemplateSummary = z.infer<typeof TemplateSummarySchema>;

export const TemplateSchema = TemplateSummarySchema.extend({
  body: z.string(),
});
export type Template = z.infer<typeof TemplateSchema>;

/** Frontmatter we expect inside template files on disk. */
export const TemplateFrontmatterSchema = z.object({
  template_id: TemplateIdSchema,
  template_name: z.string().min(1).max(200),
  type: DocumentTypeSchema,
});
export type TemplateFrontmatter = z.infer<typeof TemplateFrontmatterSchema>;
