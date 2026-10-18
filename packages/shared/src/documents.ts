import { z } from 'zod';
import { ProjectIdSchema } from './projects.js';
import { TagSchema } from './tags.js';

/**
 * Canonical list of document types. This is the single source of truth:
 * the zod enum below and every consumer (web display map, API import guards)
 * derive from this tuple, so adding a type is a one-line change here.
 */
export const DOCUMENT_TYPES = [
  'idea',
  'note',
  'design_doc',
  'implementation_plan',
  'backlog_item',
  'finding',
] as const;

export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

/** Canonical list of document statuses. Single source of truth (see above). */
export const DOCUMENT_STATUSES = ['draft', 'active', 'archived'] as const;

export const DocumentStatusSchema = z.enum(DOCUMENT_STATUSES);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

/** Type guard: is `value` a known document type? Derived from `DOCUMENT_TYPES`. */
export function isDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

/** Type guard: is `value` a known document status? Derived from `DOCUMENT_STATUSES`. */
export function isDocumentStatus(value: string): value is DocumentStatus {
  return (DOCUMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Legacy compatibility default: maps document type to a subfolder path.
 * Used when no explicit folder is supplied at document creation time.
 * This behavior is preserved for backwards compatibility with existing
 * projects. New UI flows should prefer explicit folder selection.
 *
 * @see `packages/web/src/components/NewDocumentDialog.tsx` — the current UI
 *   sends an explicit default folder and keeps this fallback for older clients.
 */
export const DOCUMENT_TYPE_TO_SUBDIR: Record<DocumentType, string> = {
  idea: 'ideas',
  note: 'notes',
  design_doc: 'design-docs',
  implementation_plan: 'implementation-plans',
  backlog_item: 'backlog',
  // For MVP, findings live alongside notes.
  finding: 'notes',
};

export { TagSchema } from './tags.js';

/**
 * Project-relative folder path under which a document lives on disk.
 *
 * Forward-slash separated, lowercase. Each segment must match
 * `^[a-z0-9][a-z0-9-_]{0,63}$`. No leading/trailing slash, no `.` or `..`,
 * no empty segments. Maximum depth is 8 segments.
 *
 * Examples: `notes`, `design`, `phases/p3/blocks`.
 */
export const FolderPathSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) => {
      if (value.startsWith('/') || value.endsWith('/')) return false;
      const segments = value.split('/');
      if (segments.length === 0 || segments.length > 8) return false;
      return segments.every((seg) => /^[a-z0-9][a-z0-9-_]{0,63}$/.test(seg));
    },
    { message: 'invalid folder path' },
  );
export type FolderPath = z.infer<typeof FolderPathSchema>;

/**
 * The frontmatter block we write into every Markdown file.
 * `id`, `created_at`, `updated_at` are always present on disk.
 */
export const FrontmatterSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  project: ProjectIdSchema,
  type: DocumentTypeSchema,
  status: DocumentStatusSchema.default('draft'),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  tags: z.array(TagSchema).default([]),
});
export type Frontmatter = z.infer<typeof FrontmatterSchema>;

/** Summary returned by the list endpoint (no body). */
export const DocumentSummarySchema = z.object({
  id: z.string().uuid(),
  project_id: ProjectIdSchema,
  title: z.string(),
  type: DocumentTypeSchema,
  status: DocumentStatusSchema,
  path: z.string(),
  tags: z.array(TagSchema),
  readOnly: z.boolean().default(false),
  created_at: z.string().datetime({ offset: true }),
  /** Last edit time, for display only. Use `revision` for If-Match. */
  updated_at: z.string().datetime({ offset: true }),
  /** Opaque fingerprint of the persisted content; send it as `If-Match`. */
  revision: z.string(),
});
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;

/** Full document returned by GET /api/documents/:id (includes body). */
export const DocumentSchema = DocumentSummarySchema.extend({
  body: z.string(),
});
export type Document = z.infer<typeof DocumentSchema>;

export const CreateDocumentRequestSchema = z.object({
  title: z.string().min(1).max(200),
  type: DocumentTypeSchema,
  status: DocumentStatusSchema.optional(),
  tags: z.array(TagSchema).optional(),
  body: z.string().optional(),
  /** Optional template id; resolved by Block 5. */
  template: z.string().min(1).max(80).optional(),
  /**
   * Project-relative folder to place the document under. When omitted,
   * the service falls back to the legacy `DOCUMENT_TYPE_TO_SUBDIR` mapping.
   * Current UI creation flows send an explicit folder.
   */
  folder: FolderPathSchema.optional(),
});
export type CreateDocumentRequest = z.infer<typeof CreateDocumentRequestSchema>;

export const UpdateDocumentRequestSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    status: DocumentStatusSchema.optional(),
    tags: z.array(TagSchema).optional(),
    body: z.string().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
export type UpdateDocumentRequest = z.infer<typeof UpdateDocumentRequestSchema>;

/**
 * Move a document to a different project-relative folder. An empty string
 * targets the project root. The reserved `archived/` folder is rejected by the
 * service — archive state is controlled through `status`, not the folder.
 */
export const MoveDocumentRequestSchema = z.object({
  folder: z.union([z.literal(''), FolderPathSchema]),
});
export type MoveDocumentRequest = z.infer<typeof MoveDocumentRequestSchema>;
