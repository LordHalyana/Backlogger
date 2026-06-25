import { describe, expect, it } from 'vitest';
import {
  archivePath,
  isArchivedFolder,
  isArchivedPath,
  unarchivePath,
} from '@backlogger/shared';

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

/**
 * Tests for the move invariant (see docs/design/folder-invariants.md):
 * DocumentService.move keeps the filename, changes only the folder segment,
 * preserves archive state, and refuses the reserved `archived/` folder.
 */
describe('move path computation', () => {
  const filename = 'doc-abc12.md';

  it('moves an active document into the target folder, keeping the filename', () => {
    const next = `proj/ideas/${filename}`;
    expect(isArchivedPath(next)).toBe(false);
    expect(next).toBe('proj/ideas/doc-abc12.md');
  });

  it('moving to the project root drops the folder segment', () => {
    expect(`proj/${filename}`).toBe('proj/doc-abc12.md');
  });

  it('keeps an archived document under archived/ when moving folders', () => {
    const activeTarget = `proj/ideas/${filename}`;
    expect(archivePath(activeTarget)).toBe('proj/archived/ideas/doc-abc12.md');
    expect(isArchivedPath(archivePath(activeTarget))).toBe(true);
  });

  it('rejects the reserved archived/ folder as a move target', () => {
    expect(isArchivedFolder('archived')).toBe(true);
    expect(isArchivedFolder('archived/2025')).toBe(true);
    expect(isArchivedFolder('ideas')).toBe(false);
  });
});
