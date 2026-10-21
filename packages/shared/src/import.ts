import { z } from 'zod';
import { DocumentTypeSchema } from './documents.js';

/**
 * Per-import placement: where the user wants the file to land if its own
 * frontmatter doesn't already specify everything.
 */
export const ImportPlacementSchema = z.object({
  /** Document type to apply when the file has no frontmatter `type`. */
  type: DocumentTypeSchema,
  /** How to derive the title when the file has no frontmatter `title`. */
  titleStrategy: z.enum(['frontmatter', 'h1', 'filename']).default('frontmatter'),
  /** What to do when the imported file's frontmatter `id` matches an existing document. */
  onDuplicate: z.enum(['skip', 'copy', 'replace']).default('skip'),
});
export type ImportPlacement = z.infer<typeof ImportPlacementSchema>;

/**
 * One file being imported. `content` is the full UTF-8 text of the `.md` file
 * (frontmatter + body); `filename` is used only for title derivation and
 * error reporting — never as an on-disk path.
 */
export const ImportFileSchema = z.object({
  filename: z
    .string()
    .min(1)
    .max(255)
    .refine((s) => s.toLowerCase().endsWith('.md'), { message: 'must be a .md file' }),
  /** Hard cap of 1 MiB per file. */
  content: z.string().max(1_048_576),
});
export type ImportFile = z.infer<typeof ImportFileSchema>;

/** Hard cap of 20 files per request. */
export const ImportRequestSchema = z.object({
  placement: ImportPlacementSchema,
  files: z.array(ImportFileSchema).min(1).max(20),
});
export type ImportRequest = z.infer<typeof ImportRequestSchema>;

export type ImportErrorCode =
  | 'INVALID_FRONTMATTER'
  | 'EMPTY_FILE'
  | 'TITLE_DERIVATION_FAILED'
  /** Blocked by a pending operation; the message names it. */
  | 'RECOVERY_REQUIRED';

export interface ImportedRow {
  filename: string;
  documentId: string;
  title: string;
}

export interface ImportSkippedRow {
  filename: string;
  reason: 'duplicate';
  existingId: string;
}

export interface ImportErrorRow {
  filename: string;
  code: ImportErrorCode;
  message: string;
}

export interface ImportResult {
  imported: ImportedRow[];
  skipped: ImportSkippedRow[];
  errors: ImportErrorRow[];
}
