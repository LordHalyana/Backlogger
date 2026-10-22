import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  emptySidecarIndex,
  SIDECAR_DIR,
  SIDECAR_INDEX_FILE,
  SidecarIndexSchema,
  type SidecarEntry,
  type SidecarIndex,
} from '@backlogger/shared';
import type { CheckedDeleteResult } from './durable.js';
import type { PathResolver } from './path-resolver.js';
import { sidecarEntryRevision } from './revision.js';

/**
 * Reads and writes a project's sidecar metadata index
 * (`<project>/.backlogger/index.json`) with atomic writes (temp file + rename).
 *
 * Keys are project-relative document paths WITHOUT the project id, e.g.
 * `guide/getting-started.md`. This module is the only writer of the sidecar
 * file; it is intentionally standalone (Phase 1) and not yet wired into
 * `DocumentService` / `ReindexService` — see docs/design/sidecar-metadata.md.
 */
export class SidecarStore {
  constructor(private readonly resolver: PathResolver) {}

  private indexPath(projectId: string): string {
    return path.join(
      this.resolver.projectDir(projectId),
      SIDECAR_DIR,
      SIDECAR_INDEX_FILE,
    );
  }

  /** Load the index, returning an empty index if the file is missing or corrupt. */
  async load(projectId: string): Promise<SidecarIndex> {
    let raw: string;
    try {
      raw = await fs.readFile(this.indexPath(projectId), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptySidecarIndex();
      throw err;
    }
    try {
      return SidecarIndexSchema.parse(JSON.parse(raw) as unknown);
    } catch {
      // A corrupt sidecar must never break indexing; treat it as empty.
      return emptySidecarIndex();
    }
  }

  /** Atomically persist an index (temp file + fsync + rename). */
  async save(projectId: string, index: SidecarIndex): Promise<void> {
    const target = this.indexPath(projectId);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const serialized = `${JSON.stringify(index, null, 2)}\n`;
    const tmp = `${target}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`;

    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(tmp, 'wx');
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
    } finally {
      await handle?.close().catch(() => undefined);
    }

    try {
      await fs.rename(tmp, target);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  async get(projectId: string, relKey: string): Promise<SidecarEntry | undefined> {
    return (await this.load(projectId)).entries[relKey];
  }

  async set(projectId: string, relKey: string, entry: SidecarEntry): Promise<void> {
    const index = await this.load(projectId);
    index.entries[relKey] = entry;
    await this.save(projectId, index);
  }

  /** Re-key an entry after an in-app move/rename. No-op if the source is absent. */
  async rename(projectId: string, fromKey: string, toKey: string): Promise<void> {
    if (fromKey === toKey) return;
    const index = await this.load(projectId);
    const entry = index.entries[fromKey];
    if (!entry) return;
    delete index.entries[fromKey];
    index.entries[toKey] = entry;
    await this.save(projectId, index);
  }

  async delete(projectId: string, relKey: string): Promise<void> {
    const index = await this.load(projectId);
    if (!(relKey in index.entries)) return;
    delete index.entries[relKey];
    await this.save(projectId, index);
  }

  /**
   * Remove an entry only while its revision (`sidecarEntryRevision`) is still
   * `expectedRevision`: a missing entry is `'missing'`, a changed one is kept
   * and reported as `'changed'`.
   */
  async deleteIfUnchanged(
    projectId: string,
    relKey: string,
    expectedRevision: string,
  ): Promise<CheckedDeleteResult> {
    const index = await this.load(projectId);
    const entry = index.entries[relKey];
    if (!entry) return 'missing';
    if (sidecarEntryRevision(entry) !== expectedRevision) return 'changed';
    delete index.entries[relKey];
    await this.save(projectId, index);
    return 'deleted';
  }

  async list(projectId: string): Promise<Record<string, SidecarEntry>> {
    return (await this.load(projectId)).entries;
  }
}
