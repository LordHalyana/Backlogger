import { z } from 'zod';
import { DocumentStatusSchema, DocumentTypeSchema } from './documents.js';
import { TagSchema } from './tags.js';

/**
 * Sidecar metadata: Backlogger-only document metadata stored next to a mounted
 * project's files instead of inside them, so source `.md` files stay pristine.
 *
 * See docs/design/sidecar-metadata.md for the full design and lifecycle.
 */

/** Reserved hidden directory holding a project's sidecar index. */
export const SIDECAR_DIR = '.backlogger';
/** Sidecar index filename inside `SIDECAR_DIR`. */
export const SIDECAR_INDEX_FILE = 'index.json';
/** Current on-disk sidecar schema version. */
export const SIDECAR_VERSION = 1;

/**
 * One sidecar entry. Keyed (in the index) by project-relative document path
 * WITHOUT the project id, e.g. `guide/getting-started.md`.
 *
 * `title` is an optional override; when absent the title is derived from the
 * file's first `#` heading or filename so the upstream file stays the source.
 */
export const SidecarEntrySchema = z.object({
  id: z.string().uuid(),
  /** Optional title override. When absent, the title is derived from the file. */
  title: z.string().min(1).max(200).optional(),
  type: DocumentTypeSchema,
  status: DocumentStatusSchema.default('draft'),
  tags: z.array(TagSchema).default([]),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type SidecarEntry = z.infer<typeof SidecarEntrySchema>;

/** The on-disk `<project>/.backlogger/index.json` document. */
export const SidecarIndexSchema = z.object({
  version: z.literal(SIDECAR_VERSION).default(SIDECAR_VERSION),
  entries: z.record(SidecarEntrySchema).default({}),
});
export type SidecarIndex = z.infer<typeof SidecarIndexSchema>;

/** An empty, current-version index. */
export function emptySidecarIndex(): SidecarIndex {
  return { version: SIDECAR_VERSION, entries: {} };
}
