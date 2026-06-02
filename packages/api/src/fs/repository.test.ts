import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DocumentNotFoundError,
  FsRepository,
  InvalidFilenameError,
  InvalidRelativePathError,
  PathResolver,
  PROJECT_SUBDIRS,
  ProjectNotFoundError,
} from './index.js';

async function makeRepo(): Promise<{ repo: FsRepository; dataDir: string }> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-repo-'));
  const resolver = new PathResolver({ dataDir });
  const repo = new FsRepository({ resolver });
  await repo.ensureRoot();
  return { repo, dataDir };
}

describe('FsRepository', () => {
  let repo: FsRepository;
  let dataDir: string;

  beforeEach(async () => {
    ({ repo, dataDir } = await makeRepo());
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  describe('ensureProjectSkeleton / removeProject', () => {
    it('creates exactly the five expected subfolders', async () => {
      await repo.ensureProjectSkeleton('home-system');
      const entries = await fs.readdir(path.join(dataDir, 'projects', 'home-system'));
      expect(entries.sort()).toEqual([...PROJECT_SUBDIRS].sort());
    });

    it('is idempotent', async () => {
      await repo.ensureProjectSkeleton('home-system');
      await expect(repo.ensureProjectSkeleton('home-system')).resolves.toBeUndefined();
    });

    it('removeProject deletes the folder', async () => {
      await repo.ensureProjectSkeleton('home-system');
      await repo.removeProject('home-system');
      expect(await repo.projectExists('home-system')).toBe(false);
    });

    it('removeProject on missing project is a no-op', async () => {
      await expect(repo.removeProject('ghost-proj')).resolves.toBeUndefined();
    });
  });

  describe('read / write round-trip', () => {
    it('round-trips frontmatter and body byte-for-byte', async () => {
      await repo.ensureProjectSkeleton('home-system');
      const rel = 'home-system/ideas/note.md';
      const body = '# Hello\n\nSome body text.\n';
      const frontmatter = { title: 'Hello', tags: ['a', 'b'], n: 42 };
      await repo.write(rel, { frontmatter, body });

      const got = await repo.read(rel);
      expect(got.path).toBe(rel);
      expect(got.body).toBe(body);
      expect(got.frontmatter).toEqual(frontmatter);
    });

    it('overwrites existing files atomically', async () => {
      await repo.ensureProjectSkeleton('home-system');
      const rel = 'home-system/ideas/note.md';
      await repo.write(rel, { frontmatter: { v: 1 }, body: 'one\n' });
      await repo.write(rel, { frontmatter: { v: 2 }, body: 'two\n' });

      const got = await repo.read(rel);
      expect(got.frontmatter).toEqual({ v: 2 });
      expect(got.body).toBe('two\n');

      // No leftover temp files in the folder.
      const dir = path.join(dataDir, 'projects', 'home-system', 'ideas');
      const entries = await fs.readdir(dir);
      expect(entries.some((e) => e.includes('.tmp.'))).toBe(false);
    });

    it('creates intermediate directories if missing', async () => {
      const rel = 'home-system/notes/deep/note.md';
      await repo.write(rel, { frontmatter: {}, body: 'hi\n' });
      const got = await repo.read(rel);
      expect(got.body).toBe('hi\n');
    });
  });

  describe('read errors', () => {
    it('throws DocumentNotFoundError for missing file', async () => {
      await repo.ensureProjectSkeleton('home-system');
      await expect(repo.read('home-system/ideas/ghost.md')).rejects.toBeInstanceOf(
        DocumentNotFoundError,
      );
    });

    it('rejects traversal in path', async () => {
      await expect(repo.read('home-system/../../etc/passwd.md')).rejects.toBeInstanceOf(
        InvalidRelativePathError,
      );
    });

    it('rejects invalid filename', async () => {
      await expect(repo.read('home-system/ideas/has space.md')).rejects.toBeInstanceOf(
        InvalidFilenameError,
      );
    });
  });

  describe('delete', () => {
    it('removes an existing file', async () => {
      const rel = 'home-system/ideas/note.md';
      await repo.write(rel, { frontmatter: {}, body: 'x' });
      await repo.delete(rel);
      await expect(repo.read(rel)).rejects.toBeInstanceOf(DocumentNotFoundError);
    });

    it('throws DocumentNotFoundError on missing file', async () => {
      await repo.ensureProjectSkeleton('home-system');
      await expect(repo.delete('home-system/ideas/ghost.md')).rejects.toBeInstanceOf(
        DocumentNotFoundError,
      );
    });
  });

  describe('listProjectFiles / walk', () => {
    it('lists only .md files, sorted', async () => {
      await repo.write('home-system/ideas/b.md', { frontmatter: {}, body: '' });
      await repo.write('home-system/ideas/a.md', { frontmatter: {}, body: '' });
      // Drop a non-markdown file; should be ignored.
      await fs.writeFile(path.join(dataDir, 'projects', 'home-system', 'ideas', 'x.txt'), 'no');

      const files = await repo.listProjectFiles('home-system');
      expect(files).toEqual(['home-system/ideas/a.md', 'home-system/ideas/b.md']);
    });

    it('throws ProjectNotFoundError for missing project', async () => {
      await expect(repo.listProjectFiles('ghost')).rejects.toBeInstanceOf(ProjectNotFoundError);
    });

    it('walk yields documents across projects', async () => {
      await repo.write('proj-a/ideas/a.md', { frontmatter: { t: 'a' }, body: 'a' });
      await repo.write('proj-b/notes/b.md', { frontmatter: { t: 'b' }, body: 'b' });

      const seen: string[] = [];
      for await (const doc of repo.walk()) {
        seen.push(doc.path);
      }
      expect(seen.sort()).toEqual(['proj-a/ideas/a.md', 'proj-b/notes/b.md']);
    });

    it('walk skips symlinked entries', async () => {
      await repo.write('proj-a/ideas/a.md', { frontmatter: {}, body: 'a' });
      const real = await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-link-'));
      try {
        await fs.writeFile(path.join(real, 'x.md'), '---\n---\nx\n');
        await fs.symlink(
          path.join(real, 'x.md'),
          path.join(dataDir, 'projects', 'proj-a', 'ideas', 'link.md'),
          'file',
        );
        const seen: string[] = [];
        for await (const doc of repo.walk()) seen.push(doc.path);
        expect(seen).toEqual(['proj-a/ideas/a.md']);
      } finally {
        await fs.rm(real, { recursive: true, force: true });
      }
    });
  });

  describe('folder management', () => {
    beforeEach(async () => {
      await repo.ensureProjectSkeleton('proj-f');
    });

    it('listFolders returns sorted project-relative folders, recursive', async () => {
      await repo.createFolder('proj-f', 'phases/p1/blocks');
      await repo.createFolder('proj-f', 'design');
      const folders = await repo.listFolders('proj-f');
      // Includes built-in skeleton subdirs + the newly created folders.
      expect(folders).toContain('design');
      expect(folders).toContain('phases');
      expect(folders).toContain('phases/p1');
      expect(folders).toContain('phases/p1/blocks');
      // Sorted
      const sorted = [...folders].sort();
      expect(folders).toEqual(sorted);
    });

    it('createFolder is idempotent and validates the path', async () => {
      await repo.createFolder('proj-f', 'design');
      await repo.createFolder('proj-f', 'design'); // no throw
      await expect(repo.createFolder('proj-f', '../escape')).rejects.toBeInstanceOf(
        InvalidRelativePathError,
      );
      await expect(repo.createFolder('proj-f', '/abs')).rejects.toBeInstanceOf(
        InvalidRelativePathError,
      );
      await expect(repo.createFolder('proj-f', 'BadCase')).rejects.toBeInstanceOf(
        InvalidRelativePathError,
      );
    });

    it('removeFolder deletes empty dir and is ENOENT-tolerant', async () => {
      await repo.createFolder('proj-f', 'tmp');
      await repo.removeFolder('proj-f', 'tmp');
      const folders = await repo.listFolders('proj-f');
      expect(folders).not.toContain('tmp');
      // ENOENT is a no-op.
      await expect(repo.removeFolder('proj-f', 'tmp')).resolves.toBeUndefined();
    });

    it('removeFolder refuses non-empty dirs', async () => {
      await repo.createFolder('proj-f', 'busy');
      await fs.writeFile(
        path.join(dataDir, 'projects', 'proj-f', 'busy', 'x.md'),
        '---\n---\nbody\n',
        'utf8',
      );
      await expect(repo.removeFolder('proj-f', 'busy')).rejects.toThrow();
    });

    it('listFolders throws ProjectNotFoundError for unknown project', async () => {
      await expect(repo.listFolders('does-not-exist')).rejects.toBeInstanceOf(
        ProjectNotFoundError,
      );
    });
  });
});
