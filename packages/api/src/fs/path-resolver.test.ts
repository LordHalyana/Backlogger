import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  InvalidFilenameError,
  InvalidProjectIdError,
  InvalidRelativePathError,
  PathOutsideDataDirError,
  PathResolver,
  SymlinkNotAllowedError,
} from './index.js';

describe('PathResolver', () => {
  let dataDir: string;
  let resolver: PathResolver;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-resolver-'));
    resolver = new PathResolver({ dataDir });
    await fs.mkdir(resolver.projectsRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  describe('assertProjectId', () => {
    it.each(['home-system', 'a1', 'home-system-2', 'abc123'])('accepts %s', (id) => {
      expect(() => resolver.assertProjectId(id)).not.toThrow();
    });

    it.each(['', 'A', '-bad', 'has space', 'has_underscore', '../etc', 'x'])(
      'rejects %s',
      (id) => {
        expect(() => resolver.assertProjectId(id)).toThrow(InvalidProjectIdError);
      },
    );
  });

  describe('assertFilename', () => {
    it.each(['note.md', 'my-doc.md', 'a.md', 'doc_1.md', 'UPPER.md', 'README.md'])('accepts %s', (n) => {
      expect(() => resolver.assertFilename(n)).not.toThrow();
    });

    it.each(['', 'no-ext', 'has space.md', '../escape.md', '.hidden.md'])(
      'rejects %s',
      (n) => {
        expect(() => resolver.assertFilename(n)).toThrow(InvalidFilenameError);
      },
    );
  });

  describe('resolveRelative', () => {
    it('resolves valid project/subdir/file paths', () => {
      const abs = resolver.resolveRelative('home-system/ideas/note.md');
      expect(abs).toBe(path.join(resolver.projectsRoot, 'home-system/ideas/note.md'));
    });

    it('rejects absolute paths', () => {
      expect(() => resolver.resolveRelative('/etc/passwd')).toThrow(InvalidRelativePathError);
    });

    it('rejects empty strings', () => {
      expect(() => resolver.resolveRelative('')).toThrow(InvalidRelativePathError);
    });

    it('rejects single-segment paths (no filename)', () => {
      expect(() => resolver.resolveRelative('home-system')).toThrow(InvalidRelativePathError);
    });

    it('rejects traversal segments', () => {
      expect(() => resolver.resolveRelative('home-system/../../etc/passwd.md')).toThrow(
        InvalidRelativePathError,
      );
      expect(() => resolver.resolveRelative('home-system/./note.md')).toThrow(
        InvalidRelativePathError,
      );
    });

    it('rejects invalid project id segment', () => {
      expect(() => resolver.resolveRelative('Bad/ideas/note.md')).toThrow(InvalidProjectIdError);
    });

    it('rejects invalid filename', () => {
      expect(() => resolver.resolveRelative('home-system/ideas/Note.MD')).toThrow(
        InvalidFilenameError,
      );
    });
  });

  describe('assertNoSymlinks', () => {
    it('passes for plain directories', async () => {
      const abs = path.join(resolver.projectsRoot, 'home-system');
      await fs.mkdir(abs, { recursive: true });
      await expect(resolver.assertNoSymlinks(abs)).resolves.toBeUndefined();
    });

    it('allows a symlink at the project-root level (Docker mount / local dev)', async () => {
      const real = await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-real-'));
      try {
        const linkPath = path.join(resolver.projectsRoot, 'linked');
        await fs.symlink(real, linkPath, 'dir');
        // The project folder itself being a symlink is fine.
        await expect(resolver.assertNoSymlinks(linkPath)).resolves.toBeUndefined();
        // A path *inside* the symlinked project is also fine (no nested symlinks).
        const target = path.join(linkPath, 'ideas', 'note.md');
        await expect(resolver.assertNoSymlinks(target)).resolves.toBeUndefined();
      } finally {
        await fs.rm(real, { recursive: true, force: true });
      }
    });

    it('throws when a path component inside a project is a symlink', async () => {
      const real = await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-real-'));
      try {
        // Create a real project folder containing a symlinked sub-directory.
        const projectPath = path.join(resolver.projectsRoot, 'linked');
        await fs.mkdir(projectPath, { recursive: true });
        const innerLink = path.join(projectPath, 'ideas');
        await fs.symlink(real, innerLink, 'dir');
        const target = path.join(innerLink, 'note.md');
        await expect(resolver.assertNoSymlinks(target)).rejects.toBeInstanceOf(
          SymlinkNotAllowedError,
        );
      } finally {
        await fs.rm(real, { recursive: true, force: true });
      }
    });

    it('throws when target is outside projects root', async () => {
      await expect(resolver.assertNoSymlinks('/etc/passwd')).rejects.toBeInstanceOf(
        PathOutsideDataDirError,
      );
    });
  });

  describe('assertFolderPath', () => {
    const resolver = new PathResolver({ dataDir: '/tmp/x' });
    it('accepts well-formed single and nested segments', () => {
      expect(resolver.assertFolderPath('design')).toBe('design');
      expect(resolver.assertFolderPath('phases/p3/blocks')).toBe('phases/p3/blocks');
      expect(resolver.assertFolderPath('a/b/c/d/e/f/g/h')).toBe('a/b/c/d/e/f/g/h');
    });
    it('rejects empty, slash, dot, traversal, depth, casing', () => {
      const bad = ['', '/abs', 'trail/', 'has space', 'UPPER', '../up', './here',
        'a//b', 'a/b/c/d/e/f/g/h/i'];
      for (const v of bad) {
        expect(() => resolver.assertFolderPath(v)).toThrow();
      }
    });
  });
});
