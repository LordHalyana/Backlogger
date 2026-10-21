import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createNoOverwrite, deleteChecked, ensureDirDurable } from './durable.js';
import { contentRevision } from './revision.js';

describe('durable file helpers', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-durable-'));
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  it('creates a file with exact bytes, creating missing directories', async () => {
    const file = path.join(dir, 'a', 'b', 'c.md');
    await createNoOverwrite(file, '---\nid: x\n---\r\nBody\n');
    expect(await fs.readFile(file, 'utf8')).toBe('---\nid: x\n---\r\nBody\n');
    expect((await fs.readdir(path.dirname(file))).sort()).toEqual(['c.md']);
  });

  it('never overwrites an existing file', async () => {
    const file = path.join(dir, 'c.md');
    await fs.writeFile(file, 'original');
    await expect(createNoOverwrite(file, 'replacement')).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await fs.readFile(file, 'utf8')).toBe('original');
    expect(await fs.readdir(dir)).toEqual(['c.md']);
  });

  it('deletes a file only while it still has the expected revision', async () => {
    const file = path.join(dir, 'c.md');
    await fs.writeFile(file, 'expected');
    expect(await deleteChecked(file, contentRevision('other'))).toBe('changed');
    expect(await fs.readFile(file, 'utf8')).toBe('expected');
    expect(await deleteChecked(file, contentRevision('expected'))).toBe('deleted');
    await expect(fs.access(file)).rejects.toThrow();
    expect(await deleteChecked(file, contentRevision('expected'))).toBe('missing');
  });

  it('creates a directory tree idempotently', async () => {
    const nested = path.join(dir, 'x', 'y');
    await ensureDirDurable(nested);
    await ensureDirDurable(nested);
    expect((await fs.stat(nested)).isDirectory()).toBe(true);
  });
});
