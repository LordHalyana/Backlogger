import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import matter from 'gray-matter';
import {
  DocumentNotFoundError,
  FsRepoError,
  ProjectNotFoundError,
} from './errors.js';
import { PathResolver, PROJECT_SUBDIRS } from './path-resolver.js';
import { SIDECAR_DIR } from '@backlogger/shared';
import { contentRevision } from './revision.js';

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

export interface FsRepositoryOptions {
  resolver: PathResolver;
}

/**
 * Filesystem-backed Markdown repository.
 *
 * The filesystem is the source of truth. All writes are atomic
 * (temp file + `fsync` + `rename`). All paths are validated through
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
   * root itself. Symlinks are skipped.
   */
  async listFolders(projectId: string): Promise<string[]> {
    if (!(await this.projectExists(projectId))) {
      throw new ProjectNotFoundError(projectId);
    }
    const root = this.resolver.projectDir(projectId);
    const out: string[] = [];
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
        out.push(childRel);
        await visit(path.join(dir, e.name), childRel);
      }
    }
    await visit(root, '');
    out.sort();
    return out;
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
   * Atomically write a Markdown document.
   *
   * Strategy: write to `<target>.tmp.<pid>.<rand>` in the same directory,
   * fsync, then rename. On error, the temp file is best-effort removed.
   * Returns the revision of the written content.
   */
  async write(
    relativePath: string,
    doc: Pick<RawDocument, 'frontmatter' | 'body'>,
  ): Promise<string> {
    const absolute = this.resolver.resolveRelative(relativePath);
    await this.resolver.assertNoSymlinks(absolute);
    await fs.mkdir(path.dirname(absolute), { recursive: true });

    const serialized = matter.stringify(doc.body, doc.frontmatter);
    await this.writeAtomic(absolute, serialized);
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
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await this.writeAtomic(absolute, content);
    return contentRevision(content);
  }

  private async writeAtomic(absolute: string, content: string): Promise<void> {
    const tmpName = `${path.basename(absolute)}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`;
    const tmpPath = path.join(path.dirname(absolute), tmpName);

    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(tmpPath, 'wx');
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle?.close().catch(() => undefined);
    }

    try {
      await fs.rename(tmpPath, absolute);
    } catch (err) {
      await fs.rm(tmpPath, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  /** Delete a document file. Throws `DocumentNotFoundError` if missing. */
  async delete(relativePath: string): Promise<void> {
    const absolute = await this.resolver.resolveRelativeSafe(relativePath);
    try {
      await fs.unlink(absolute);
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

  /** Yield every parseable `.md` document under one project. */
  async *walkProject(projectId: string): AsyncIterable<RawDocument> {
    this.resolver.assertProjectId(projectId);
    const projectDir = this.resolver.projectDir(projectId);
    yield* walkMarkdown(projectDir, this.resolver.projectsRoot);
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
