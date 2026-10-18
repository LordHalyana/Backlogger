import { createHash } from 'node:crypto';
import { SidecarEntrySchema, type SidecarEntry } from '@backlogger/shared';

/**
 * Opaque document revisions. A revision fingerprints the full persisted
 * content, so it changes with every write that changes the file (including
 * two writes in the same millisecond) and with out-of-band edits on disk.
 */

/** Revision of a file's exact bytes. */
export function contentRevision(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 32);
}

/** Revision of a sidecar-backed document: its file plus its sidecar entry. */
export function sidecarRevision(fileRevision: string, entry: SidecarEntry): string {
  const canonical = JSON.stringify(SidecarEntrySchema.parse(entry));
  return contentRevision(`${fileRevision}\0${canonical}`);
}
