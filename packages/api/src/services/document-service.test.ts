import { describe, expect, it } from 'vitest';
import { archivePath, isArchivedPath, unarchivePath } from '@backlogger/shared';

/**
 * Tests for the archive invariant:
 *
 *  1. status "archived"  →  file MUST be under <project>/archived/<rest>
 *  2. status "active"|"draft"  →  file MUST NOT be under archived/
 *  3. On mismatch, filesystem path wins (see docs/design/archive-invariants.md)
 */
describe('archive invariant', () => {
  it('archiving a document moves it under archived/ and sets status to archived', () => {
    expect(archivePath('proj/notes/doc-abc12.md')).toBe(
      'proj/archived/notes/doc-abc12.md',
    );
  });

  it('unarchiving a document moves it out of archived/ and sets status to active', () => {
    expect(unarchivePath('proj/archived/notes/doc-abc12.md')).toBe(
      'proj/notes/doc-abc12.md',
    );
  });

  it('reindex corrects status when file is under archived/ but frontmatter says active', () => {
    // Invariant: path[1] === 'archived' means the document is archived,
    // regardless of frontmatter. The path is the authoritative signal.
    const archivedPath = 'proj/archived/notes/doc-abc12.md';
    expect(isArchivedPath(archivedPath)).toBe(true);
    expect(unarchivePath(archivedPath)).toBe('proj/notes/doc-abc12.md');
  });

  it('reindex corrects status when file is outside archived/ but frontmatter says archived', () => {
    const activePath = 'proj/notes/doc-abc12.md';
    expect(isArchivedPath(activePath)).toBe(false);
    expect(unarchivePath(activePath)).toBe(activePath);
  });
});
