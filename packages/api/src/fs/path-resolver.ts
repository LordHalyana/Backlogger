import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  InvalidFilenameError,
  InvalidProjectIdError,
  InvalidRelativePathError,
  PathOutsideDataDirError,
  SymlinkNotAllowedError,
} from './errors.js';

/** Pattern for project ids (kebab-case slug). */
export const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** Pattern for individual `.md` filenames (no slashes). Uppercase stems are allowed (e.g. README.md). */
export const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9-_]{0,127}\.md$/;

/** Pattern for a single folder segment under a project. */
export const FOLDER_SEGMENT_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;

/** Maximum nesting depth for project subfolders. */
export const FOLDER_MAX_DEPTH = 8;

/** Subdirectories that make up a project skeleton. */
export const PROJECT_SUBDIRS = [
  'ideas',
  'design-docs',
  'implementation-plans',
  'backlog',
  'notes',
] as const;
export type ProjectSubdir = (typeof PROJECT_SUBDIRS)[number];

export interface PathResolverOptions {
  /** Absolute path to BACKLOGGER_DATA_DIR. */
  dataDir: string;
}

/**
 * Resolves and validates filesystem paths under the data dir.
 *
 * All public methods return absolute paths and guarantee the result lies
 * within `<dataDir>/projects/`. Any escape attempt, traversal, or symlink
 * encountered along the way throws an `FsRepoError`.
 */
export class PathResolver {
  readonly dataDir: string;
  readonly projectsRoot: string;

  constructor(opts: PathResolverOptions) {
    this.dataDir = path.resolve(opts.dataDir);
    this.projectsRoot = path.join(this.dataDir, 'projects');
  }

  /** Validate a project id slug. Throws on invalid input. */
  assertProjectId(projectId: string): void {
    if (typeof projectId !== 'string' || !PROJECT_ID_RE.test(projectId)) {
      throw new InvalidProjectIdError(projectId);
    }
  }

  /** Validate a single `.md` filename. Throws on invalid input. */
  assertFilename(filename: string): void {
    if (typeof filename !== 'string' || !FILENAME_RE.test(filename)) {
      throw new InvalidFilenameError(filename);
    }
  }

  /** Absolute path to a project's root folder. */
  projectDir(projectId: string): string {
    this.assertProjectId(projectId);
    return path.join(this.projectsRoot, projectId);
  }

  /** Absolute path to a project subfolder (e.g. `ideas`). */
  projectSubdir(projectId: string, sub: ProjectSubdir): string {
    return path.join(this.projectDir(projectId), sub);
  }

  /**
   * Validate a project-relative folder path. Forward-slash separated,
   * each segment matches `FOLDER_SEGMENT_RE`, depth <= `FOLDER_MAX_DEPTH`.
   * Throws `InvalidRelativePathError` on any violation. Returns the
   * normalized (forward-slash) path on success.
   */
  assertFolderPath(folder: string): string {
    if (typeof folder !== 'string' || folder.length === 0) {
      throw new InvalidRelativePathError(String(folder));
    }
    if (folder.startsWith('/') || folder.endsWith('/')) {
      throw new InvalidRelativePathError(folder);
    }
    const normalized = folder.replace(/\\/g, '/');
    const segments = normalized.split('/');
    if (segments.length === 0 || segments.length > FOLDER_MAX_DEPTH) {
      throw new InvalidRelativePathError(folder);
    }
    for (const seg of segments) {
      if (!FOLDER_SEGMENT_RE.test(seg)) {
        throw new InvalidRelativePathError(folder);
      }
    }
    return normalized;
  }

  /** Absolute path to an arbitrary project-relative folder. */
  projectFolderPath(projectId: string, folder: string): string {
    const normalized = this.assertFolderPath(folder);
    return path.join(this.projectDir(projectId), normalized);
  }

  /**
   * Resolve a relative path under `<dataDir>/projects/` to an absolute path.
   *
   * Accepts forward-slash paths like `home-system/ideas/note.md`. Rejects:
   * - empty strings
   * - absolute paths
   * - paths containing `..` segments
   * - paths whose final filename does not match `FILENAME_RE`
   * - paths escaping `projectsRoot`
   */
  resolveRelative(relativePath: string): string {
    if (typeof relativePath !== 'string' || relativePath.length === 0) {
      throw new InvalidRelativePathError(String(relativePath));
    }
    if (path.isAbsolute(relativePath)) {
      throw new InvalidRelativePathError(relativePath);
    }

    const normalized = relativePath.replace(/\\/g, '/');
    const segments = normalized.split('/');
    if (segments.length < 2) {
      throw new InvalidRelativePathError(relativePath);
    }
    for (const segment of segments) {
      if (segment.length === 0 || segment === '.' || segment === '..') {
        throw new InvalidRelativePathError(relativePath);
      }
    }
    const projectId = segments[0]!;
    this.assertProjectId(projectId);
    const filename = segments[segments.length - 1]!;
    this.assertFilename(filename);

    const absolute = path.resolve(this.projectsRoot, normalized);
    if (!this.isInsideProjectsRoot(absolute)) {
      throw new PathOutsideDataDirError(relativePath);
    }
    return absolute;
  }

  /**
   * Resolve an existing entry under a project, file or folder, whatever its
   * name (deletion inventories cover every file in scope, not only the
   * names Backlogger creates), and assert that no component below the
   * project folder is a symlink. Rejects empty, `.` and `..` segments,
   * absolute paths, NUL bytes and paths escaping `projectsRoot`. A bare
   * project id resolves to the project folder.
   */
  async resolveEntrySafe(relativePath: string): Promise<string> {
    if (typeof relativePath !== 'string' || relativePath.length === 0) {
      throw new InvalidRelativePathError(String(relativePath));
    }
    const normalized = relativePath.replace(/\\/g, '/');
    if (path.isAbsolute(relativePath) || normalized.includes('\0')) {
      throw new InvalidRelativePathError(relativePath);
    }
    const segments = normalized.split('/');
    for (const segment of segments) {
      if (segment.length === 0 || segment === '.' || segment === '..') {
        throw new InvalidRelativePathError(relativePath);
      }
    }
    this.assertProjectId(segments[0]!);
    const absolute = path.resolve(this.projectsRoot, normalized);
    if (!this.isInsideProjectsRoot(absolute)) {
      throw new PathOutsideDataDirError(relativePath);
    }
    await this.assertNoSymlinks(absolute);
    return absolute;
  }

  /**
   * Like `resolveRelative` but also asserts that no path component on disk is
   * a symlink. Use this for read/write operations on existing files.
   */
  async resolveRelativeSafe(relativePath: string): Promise<string> {
    const absolute = this.resolveRelative(relativePath);
    await this.assertNoSymlinks(absolute);
    return absolute;
  }

  /** True iff `absolute` is inside the projects root. */
  isInsideProjectsRoot(absolute: string): boolean {
    const rel = path.relative(this.projectsRoot, absolute);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }

  /**
   * Walk every path component between `projectsRoot` and `absolute` and
   * confirm none of them is a symlink. Throws `SymlinkNotAllowedError` if any
   * existing component is a symlink. Missing components are ignored (so this
   * is safe to call before creating a file).
   *
   * **Exception**: the project root directory itself (the first segment after
   * `projectsRoot`) is allowed to be a symlink. This supports Docker volume
   * mounts and local dev setups where the entire project folder is symlinked
   * from another location (e.g. `data/projects/backlogger-docs → ../../docs`).
   * Symlinks at any deeper level — within the project's content tree — are
   * still rejected to prevent path-traversal attacks via user-controlled files.
   */
  async assertNoSymlinks(absolute: string): Promise<void> {
    if (!this.isInsideProjectsRoot(absolute)) {
      throw new PathOutsideDataDirError(absolute);
    }
    const rel = path.relative(this.projectsRoot, absolute);
    const parts = rel.split(path.sep).filter((p) => p.length > 0);
    let current = this.projectsRoot;
    // Also check the projects root itself.
    await this.lstatOrSkip(current);
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]!);
      // The project root directory (i === 0) may be a symlink — this is
      // intentional for Docker mounts and local dev symlink setups.
      // Everything deeper must be a real file/directory.
      if (i === 0) continue;
      // eslint-disable-next-line no-await-in-loop
      await this.lstatOrSkip(current);
    }
  }

  private async lstatOrSkip(absolute: string): Promise<void> {
    try {
      const st = await fs.lstat(absolute);
      if (st.isSymbolicLink()) {
        throw new SymlinkNotAllowedError(absolute);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }
}
