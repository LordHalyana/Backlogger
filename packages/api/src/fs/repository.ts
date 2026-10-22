import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import matter from 'gray-matter';
import {
  DocumentNotFoundError,
  FsRepoError,
  NotUtf8Error,
  ProjectNotFoundError,
} from './errors.js';
import { PathResolver, PROJECT_SUBDIRS } from './path-resolver.js';
import {
  COMMENTS_SEGMENT,
  isCommentStorageFolder,
  isCommentStoragePath,
  SIDECAR_DIR,
  TICKETS_SEGMENT,
} from '@backlogger/shared';
import { contentRevision } from './revision.js';
import {
  createNoOverwrite,
  deleteChecked,
  removeEmptyDirDurable,
  replaceDurable,
  unlinkDurable,
  type CheckedDeleteResult,
} from './durable.js';

/** A parsed Markdown document on disk. */
export interface RawDocument {
  /** Path relative to `<dataDir>/projects/`, forward-slash separated. */
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  /** Fingerprint of the file's exact bytes (see `contentRevision`). */
  revision: string;
  createdAt?: string;
  updatedAt?: string;
}

/** One entry of a directory listing (`listDir`). */
export interface DirEntry {
  /** Relative to `<dataDir>/projects/`. */
  path: string;
  kind: 'file' | 'directory' | 'symlink' | 'other';
}

/** One file found in a task's comment directory, read but not yet validated. */
export type CommentFileEntry =
  | { path: string; text: string }
  | { path: string; text: null; problem: string };

export interface FsRepositoryOptions {
  resolver: PathResolver;
}

/**
 * Filesystem-backed Markdown repository.
 *
 * The filesystem is the source of truth. All writes are atomic and durable
 * (temp file + `fsync` + `rename` + directory `fsync`). All paths are validated through
 * the injected `PathResolver`.
 */
export class FsRepository {
  private readonly resolver: PathResolver;

  constructor(opts: FsRepositoryOptions) {
    this.resolver = opts.resolver;
  }

  /** Ensure `<dataDir>/projects/` exists. Safe to call repeatedly. */
  async ensureRoot(): Promise<void> {
    await fs.mkdir(this.resolver.projectsRoot, { recursive: true });
  }

  /**
   * Resolve a project-relative path to an absolute on-disk path, asserting
   * that no component is a symlink. Throws `FsRepoError` on invalid input.
   *
   * Exposed so HTTP handlers can `res.sendFile` the resolved absolute path
   * without having to depend on the underlying `PathResolver` directly.
   */
  async resolveAbsolutePath(relativePath: string): Promise<string> {
    return this.resolver.resolveRelativeSafe(relativePath);
  }

  /** Create the standard subfolder skeleton for a project. Idempotent. */
  async ensureProjectSkeleton(projectId: string): Promise<void> {
    await this.ensureRoot();
    const projectDir = this.resolver.projectDir(projectId);
    await fs.mkdir(projectDir, { recursive: true });
    await Promise.all(
      PROJECT_SUBDIRS.map((sub) =>
        fs.mkdir(this.resolver.projectSubdir(projectId, sub), { recursive: true }),
      ),
    );
  }

  /** Remove a project's folder and everything under it. */
  async removeProject(projectId: string): Promise<void> {
    const projectDir = this.resolver.projectDir(projectId);
    try {
      await fs.rm(projectDir, { recursive: true, force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  /** True iff the project folder exists. */
  async projectExists(projectId: string): Promise<boolean> {
    try {
      const st = await fs.stat(this.resolver.projectDir(projectId));
      return st.isDirectory();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  /**
   * List every subfolder under a project, recursively, as project-relative
   * forward-slash paths. Sorted lexicographically. Excludes the project
   * root itself. Symlinks are skipped, and so is comment storage: each
   * `tickets/<id>/comments` directory, and its `tickets/<id>` parent unless
   * that holds other folders.
   */
  async listFolders(projectId: string): Promise<string[]> {
    if (!(await this.projectExists(projectId))) {
      throw new ProjectNotFoundError(projectId);
    }
    const root = this.resolver.projectDir(projectId);
    const out: string[] = [];
    const commentParents = new Set<string>();
    async function visit(dir: string, rel: string): Promise<void> {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw err;
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (e.isSymbolicLink()) continue;
        if (e.name === SIDECAR_DIR) continue; // reserved sidecar metadata dir
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (isCommentStorageFolder(childRel)) {
          commentParents.add(rel);
          continue;
        }
        out.push(childRel);
        await visit(path.join(dir, e.name), childRel);
      }
    }
    await visit(root, '');
    const shown = out.filter(
      (f) => !commentParents.has(f) || out.some((o) => o.startsWith(`${f}/`)),
    );
    shown.sort();
    return shown;
  }

  /**
   * Create a project-relative folder. Idempotent: succeeds whether the
   * folder already exists or not. Validates the path via the resolver.
   */
  async createFolder(projectId: string, folder: string): Promise<string> {
    if (!(await this.projectExists(projectId))) {
      throw new ProjectNotFoundError(projectId);
    }
    const abs = this.resolver.projectFolderPath(projectId, folder);
    await this.resolver.assertNoSymlinks(abs);
    await fs.mkdir(abs, { recursive: true });
    return this.resolver.assertFolderPath(folder);
  }

  /**
   * Remove a project-relative folder. Throws if the folder contains any
   * files or subfolders. Idempotent: ENOENT is treated as success.
   */
  async removeFolder(projectId: string, folder: string): Promise<void> {
    if (!(await this.projectExists(projectId))) {
      throw new ProjectNotFoundError(projectId);
    }
    const abs = this.resolver.projectFolderPath(projectId, folder);
    try {
      await fs.rmdir(abs);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      throw err;
    }
  }

  /**
   * List relative paths of all `.md` files under a project.
   * Sorted lexicographically. Throws `ProjectNotFoundError` if missing.
   */
  async listProjectFiles(projectId: string): Promise<string[]> {
    if (!(await this.projectExists(projectId))) {
      throw new ProjectNotFoundError(projectId);
    }
    const out: string[] = [];
    for await (const doc of this.walkProject(projectId)) {
      out.push(doc.path);
    }
    out.sort();
    return out;
  }

  /** Read and parse a Markdown document. */
  async read(relativePath: string): Promise<RawDocument> {
    const absolute = await this.resolver.resolveRelativeSafe(relativePath);
    let raw: string;
    try {
      raw = await fs.readFile(absolute, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new DocumentNotFoundError(relativePath);
      }
      throw err;
    }
    const parsed = parseMarkdown(raw);
    return {
      path: toForwardSlash(relativePath),
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      revision: contentRevision(raw),
    };
  }

  /** A file's exact text, unparsed. */
  async readText(relativePath: string): Promise<string> {
    const absolute = await this.resolver.resolveRelativeSafe(relativePath);
    try {
      return await fs.readFile(absolute, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new DocumentNotFoundError(relativePath);
      }
      throw err;
    }
  }

  /**
   * A file's text, only when its bytes are valid UTF-8 (a BOM included), so
   * writing the text back reproduces the file byte for byte. Throws
   * `NotUtf8Error` otherwise.
   */
  async readExactText(relativePath: string): Promise<string> {
    const absolute = await this.resolver.resolveRelativeSafe(relativePath);
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(absolute);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new DocumentNotFoundError(relativePath);
      }
      throw err;
    }
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new NotUtf8Error(relativePath);
    }
  }

  /** The entries of one directory, sorted by name; `[]` when it does not exist. */
  async listDir(relativeDir: string): Promise<DirEntry[]> {
    const absolute = await this.resolveDirSafe(relativeDir);
    return (await readDirSorted(absolute)).map((entry) => ({
      path: `${toForwardSlash(relativeDir)}/${entry.name}`,
      kind: entry.isSymbolicLink()
        ? 'symlink'
        : entry.isDirectory()
          ? 'directory'
          : entry.isFile()
            ? 'file'
            : 'other',
    }));
  }

  /**
   * Remove a directory only when it is empty (never recursively), durably.
   * Returns whether it was removed.
   */
  async removeEmptyDir(relativeDir: string): Promise<boolean> {
    const absolute = await this.resolveDirSafe(relativeDir);
    return removeEmptyDirDurable(absolute);
  }

  /** A project folder (project id first), validated and free of symlinks below the project. */
  private async resolveDirSafe(relativeDir: string): Promise<string> {
    const [projectId = '', ...folder] = toForwardSlash(relativeDir).split('/');
    const absolute = this.resolver.projectFolderPath(projectId, folder.join('/'));
    await this.resolver.assertNoSymlinks(absolute);
    return absolute;
  }

  /**
   * Atomically write a Markdown document.
   *
   * Strategy: write to `<target>.tmp.<pid>.<rand>` in the same directory,
   * fsync, rename, then fsync the directory. On error, the temp file is
   * best-effort removed.
   * Returns the revision of the written content.
   */
  async write(
    relativePath: string,
    doc: Pick<RawDocument, 'frontmatter' | 'body'>,
  ): Promise<string> {
    const absolute = this.resolver.resolveRelative(relativePath);
    await this.resolver.assertNoSymlinks(absolute);

    const serialized = matter.stringify(doc.body, doc.frontmatter);
    await replaceDurable(absolute, serialized);
    return contentRevision(serialized);
  }

  /**
   * Atomically write raw file content with NO frontmatter serialization.
   * Used by sidecar-mode projects so source `.md` files stay frontmatter-free.
   * Returns the revision of the written content.
   */
  async writeRaw(relativePath: string, content: string): Promise<string> {
    const absolute = this.resolver.resolveRelative(relativePath);
    await this.resolver.assertNoSymlinks(absolute);
    await replaceDurable(absolute, content);
    return contentRevision(content);
  }

  /**
   * Create a file that must not exist yet, durably (see `createNoOverwrite`).
   * Rejects with `EEXIST`, leaving the existing file untouched, when it does.
   */
  async createNew(relativePath: string, content: string): Promise<void> {
    const absolute = this.resolver.resolveRelative(relativePath);
    await this.resolver.assertNoSymlinks(absolute);
    await createNoOverwrite(absolute, content);
  }

  /**
   * Delete a file only while its bytes still have `expectedRevision`
   * (see `deleteChecked`): a missing file is `'missing'`, a changed one is
   * kept and reported as `'changed'`.
   */
  async deleteIfUnchanged(
    relativePath: string,
    expectedRevision: string,
  ): Promise<CheckedDeleteResult> {
    const absolute = await this.resolver.resolveRelativeSafe(relativePath);
    return deleteChecked(absolute, expectedRevision);
  }

  /** Delete a document file. Throws `DocumentNotFoundError` if missing. */
  async delete(relativePath: string): Promise<void> {
    const absolute = await this.resolver.resolveRelativeSafe(relativePath);
    try {
      await unlinkDurable(absolute);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new DocumentNotFoundError(relativePath);
      }
      throw err;
    }
  }

  /** Yield every parseable `.md` document under `<dataDir>/projects/`. */
  async *walk(): AsyncIterable<RawDocument> {
    try {
      const entries = await fs.readdir(this.resolver.projectsRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        yield* this.walkProject(entry.name);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  /**
   * Yield every parseable `.md` document under one project. Comment storage
   * (`tickets/<id>/comments/`) is skipped: those files are comments, which
   * `walkComments` yields.
   */
  async *walkProject(projectId: string): AsyncIterable<RawDocument> {
    this.resolver.assertProjectId(projectId);
    const projectDir = this.resolver.projectDir(projectId);
    yield* walkMarkdown(projectDir, this.resolver.projectsRoot);
  }

  /**
   * Yield every entry inside each `<project>/tickets/<id>/comments/`
   * directory, recursively, sorted by path: the text of regular files, and a
   * problem for anything that cannot be read as one (symlinks, unreadable
   * files). Validation is the caller's; nothing is changed.
   */
  async *walkComments(projectId: string): AsyncIterable<CommentFileEntry> {
    this.resolver.assertProjectId(projectId);
    const root = this.resolver.projectsRoot;
    const ticketsDir = path.join(this.resolver.projectDir(projectId), TICKETS_SEGMENT);
    for (const task of await readDirSorted(ticketsDir)) {
      if (!task.isDirectory()) continue;
      const dir = path.join(ticketsDir, task.name, COMMENTS_SEGMENT);
      yield* walkCommentDir(dir, root);
    }
  }
}

async function readDirSorted(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw err;
  }
}

async function* walkCommentDir(dir: string, root: string): AsyncIterable<CommentFileEntry> {
  for (const entry of await readDirSorted(dir)) {
    const abs = path.join(dir, entry.name);
    const rel = toForwardSlash(path.relative(root, abs));
    if (entry.isSymbolicLink()) {
      yield { path: rel, text: null, problem: 'symbolic links are not followed' };
    } else if (entry.isDirectory()) {
      yield* walkCommentDir(abs, root);
    } else if (!entry.isFile()) {
      yield { path: rel, text: null, problem: 'not a regular file' };
    } else {
      try {
        yield { path: rel, text: await fs.readFile(abs, 'utf8') };
      } catch (err) {
        yield { path: rel, text: null, problem: `unreadable: ${(err as Error).message}` };
      }
    }
  }
}

async function* walkMarkdown(
  dir: string,
  rootForRelative: string,
): AsyncIterable<RawDocument> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue; // skip symlinks defensively
    if (entry.isDirectory()) {
      if (entry.name === SIDECAR_DIR) continue; // reserved sidecar metadata dir
      if (isCommentStoragePath(toForwardSlash(path.relative(rootForRelative, abs)))) continue;
      yield* walkMarkdown(abs, rootForRelative);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const rel = toForwardSlash(path.relative(rootForRelative, abs));
      try {
        const st = await fs.stat(abs);
        const raw = await fs.readFile(abs, 'utf8');
        const parsed = parseMarkdown(raw);
        yield {
          path: rel,
          frontmatter: parsed.frontmatter,
          body: parsed.body,
          revision: contentRevision(raw),
          createdAt: st.birthtime.toISOString(),
          updatedAt: st.mtime.toISOString(),
        };
      } catch (err) {
        if (err instanceof FsRepoError) throw err;
        // Skip files that fail to parse; reindex callers can log them.
      }
    }
  }
}

function toForwardSlash(p: string): string {
  return p.replace(/\\/g, '/');
}

function parseMarkdown(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  try {
    const parsed = matter(raw);
    return {
      frontmatter: { ...(parsed.data as Record<string, unknown>) },
      body: parsed.content,
    };
  } catch {
    return { frontmatter: {}, body: raw };
  }
}
