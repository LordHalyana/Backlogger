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

/**
 * Revision of a file's raw bytes: equal to `contentRevision` of its text for
 * any valid UTF-8 file, and exact for files that are not.
 */
export function bytesRevision(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32);
}

/** Revision of a sidecar entry alone, as the sidecar store reads it back. */
export function sidecarEntryRevision(entry: SidecarEntry): string {
  return contentRevision(JSON.stringify(SidecarEntrySchema.parse(entry)));
}

/** Revision of a sidecar-backed document: its file plus its sidecar entry. */
export function sidecarRevision(fileRevision: string, entry: SidecarEntry): string {
  const canonical = JSON.stringify(SidecarEntrySchema.parse(entry));
  return contentRevision(`${fileRevision}\0${canonical}`);
}
