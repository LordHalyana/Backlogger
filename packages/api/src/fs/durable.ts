import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { bytesRevision } from './revision.js';

/**
 * Durable file helpers for the write coordinator. A rename, unlink or mkdir
 * is only durable once its parent directory is fsynced too, so every helper
 * here syncs the directories it changed. Paths are absolute and must already
 * have been validated (no traversal, no symlinks) by the caller.
 */

/** fsync a directory so entries created, renamed or removed in it persist. */
export async function fsyncDir(dir: string): Promise<void> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(dir, 'r');
    await handle.sync();
  } catch (err) {
    // Windows cannot open or sync a directory handle; everywhere else a
    // failed directory fsync is a durability failure and must surface.
    const code = (err as NodeJS.ErrnoException).code;
    const unsupported = code === 'EISDIR' || code === 'EPERM' || code === 'EINVAL';
    if (!(process.platform === 'win32' && unsupported)) throw err;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** `mkdir -p`, then fsync the parent of every directory it created. */
export async function ensureDirDurable(dir: string): Promise<void> {
  const first = await fs.mkdir(dir, { recursive: true });
  if (first === undefined) return;
  // `first` is the topmost directory created; sync it and each one below.
  for (let d = dir; ; d = path.dirname(d)) {
    await fsyncDir(path.dirname(d));
    if (d === first || path.dirname(d) === d) break;
  }
}

/**
 * Whether `name` is a temp file `writeTemp` made for a target named
 * `targetName`: what a process killed mid-write leaves beside the target.
 */
export function isWriteLeftover(name: string, targetName: string): boolean {
  return (
    name.startsWith(`${targetName}.tmp.`) &&
    /^\d+\.[0-9a-f]{12}$/.test(name.slice(targetName.length + 5))
  );
}

/** Write `content` to a fresh temp file beside `target` and fsync it. */
async function writeTemp(target: string, content: string): Promise<string> {
  const tmp = path.join(
    path.dirname(target),
    `${path.basename(target)}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`,
  );
  const handle = await fs.open(tmp, 'wx');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } catch (err) {
    await handle.close().catch(() => undefined);
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
  await handle.close();
  return tmp;
}

/** Atomically replace `target` with `content` (temp file, fsync, rename, dir fsync). */
export async function replaceDurable(target: string, content: string): Promise<void> {
  await ensureDirDurable(path.dirname(target));
  const tmp = await writeTemp(target, content);
  try {
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
  await fsyncDir(path.dirname(target));
}

/**
 * Create `target` with exactly `content`, failing with `EEXIST` (and leaving
 * the existing file untouched) when something is already there. The file
 * appears complete or not at all: it is written to a temp file and hard-linked
 * into place, which, unlike rename, refuses to replace an existing entry.
 */
export async function createNoOverwrite(target: string, content: string): Promise<void> {
  await ensureDirDurable(path.dirname(target));
  const tmp = await writeTemp(target, content);
  try {
    await fs.link(tmp, target);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
  await fsyncDir(path.dirname(target));
}

export type CheckedDeleteResult = 'deleted' | 'missing' | 'changed';

/**
 * Remove `target` only while its bytes still have `expectedRevision` (see
 * `bytesRevision`). A
 * missing file counts as already removed; a changed one is kept and reported.
 * Single-process: nothing else in Backlogger writes between the check and the
 * unlink, because the caller holds the file's project queue.
 */
export async function deleteChecked(
  target: string,
  expectedRevision: string,
): Promise<CheckedDeleteResult> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw err;
  }
  if (bytesRevision(bytes) !== expectedRevision) return 'changed';
  await unlinkDurable(target);
  return 'deleted';
}

/** Unlink `target` and fsync its directory. Throws `ENOENT` when missing. */
export async function unlinkDurable(target: string): Promise<void> {
  await fs.unlink(target);
  await fsyncDir(path.dirname(target));
}

/**
 * Remove `dir` only when it is empty, and fsync its parent. Returns whether
 * it was removed; a missing directory or one with entries left is kept as is.
 * Never recursive.
 */
export async function removeEmptyDirDurable(dir: string): Promise<boolean> {
  try {
    await fs.rmdir(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTEMPTY' || code === 'EEXIST') return false;
    throw err;
  }
  await fsyncDir(path.dirname(dir));
  return true;
}

/**
 * Remove the temp files `writeTemp` left in `dir` for any of `targetNames`
 * (see `isWriteLeftover`), never following symlinks, then fsync `dir`.
 */
export async function removeWriteLeftoversDurable(
  dir: string,
  targetNames: readonly string[],
): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  const leftovers = entries.filter(
    (e) => e.isFile() && targetNames.some((t) => isWriteLeftover(e.name, t)),
  );
  for (const e of leftovers) await fs.rm(path.join(dir, e.name), { force: true });
  if (leftovers.length > 0) await fsyncDir(dir);
}
