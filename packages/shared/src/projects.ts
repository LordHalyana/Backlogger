import { z } from 'zod';

/** Kebab-case project id, also used as the folder name on disk. */
export const ProjectIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, {
  message: 'project id must be kebab-case, 2-63 chars, [a-z0-9-]',
});

/** How a project stores Backlogger metadata: inside each file, or in a sidecar. */
export const MetadataModeSchema = z.enum(['frontmatter', 'sidecar']);
export type MetadataMode = z.infer<typeof MetadataModeSchema>;

export const ProjectSchema = z.object({
  id: ProjectIdSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  readOnly: z.boolean().default(false),
  metadataMode: MetadataModeSchema.default('frontmatter'),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const CreateProjectRequestSchema = z.object({
  id: ProjectIdSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

export const UpdateProjectRequestSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    readOnly: z.boolean().optional(),
    metadataMode: MetadataModeSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

/** A project as the API returns it. */
export type Project = z.infer<typeof ProjectSchema> & {
  /** True for the one designated Inbox. */
  isInbox: boolean;
};
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>;
