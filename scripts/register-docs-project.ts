#!/usr/bin/env -S npx tsx
/**
 * Register (or re-register) the `backlogger-docs` symlinked project.
 *
 * Unlike seed-docs-project.ts this script works IN-PLACE on the docs/
 * folder via the symlink at data/projects/backlogger-docs → ../../../../docs.
 * It never deletes or copies files; it only:
 *
 *  1. Upserts the project row in SQLite.
 *  2. Walks every .md file in the symlinked tree and, if the file lacks a
 *     valid Backlogger id/project/type/status frontmatter, prepends one
 *     (preserving any existing template_id / other custom fields).
 *  3. Runs a project-scoped reindex so documents are immediately visible.
 *
 * Idempotent: safe to run multiple times. Files that already have a valid
 * `id:` in their frontmatter are left unchanged.
 */
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../packages/api/src/db/database.ts';
import { buildContext } from '../packages/api/src/context.ts';

const PROJECT_ID = 'backlogger-docs';
const PROJECT_NAME = 'Backlogger Documentation';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const dataDir = path.resolve(
  process.env.BACKLOGGER_DATA_DIR ?? path.join(repoRoot, 'packages', 'api', 'data'),
);
const projectDir = path.join(dataDir, 'projects', PROJECT_ID);
const dbFile = path.join(dataDir, 'backlogger.sqlite');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DocType = 'design_doc' | 'implementation_plan' | 'note';

function classify(rel: string): { type: DocType; tags: string[]; status: 'active' | 'archived' } {
  const parts = rel.split(path.sep);
  const tags = new Set<string>();

  // Files physically inside archived/ sub-tree → status archived.
  const status = parts[0] === 'archived' ? 'archived' : 'active';

  // Use the first path segment (skipping 'archived') for tagging.
  const topSegment = status === 'archived' ? parts[1] : parts[0];
  if (topSegment && !topSegment.endsWith('.md')) tags.add(topSegment.toLowerCase());

  if (/implementation_plan\.md$/i.test(rel) || /\broadmap\.md$/i.test(rel)) {
    return { type: 'implementation_plan', tags: [...tags], status };
  }
  if (
    (status === 'archived' ? parts[1] : parts[0]) === 'design' ||
    /\bdesign\.md$/i.test(rel) ||
    parts.includes('blocks')
  ) {
    return { type: 'design_doc', tags: [...tags], status };
  }
  if ((status === 'archived' ? parts[1] : parts[0]) === 'findings') tags.add('findings');
  if ((status === 'archived' ? parts[1] : parts[0]) === 'operations') tags.add('operations');
  return { type: 'note', tags: [...tags], status };
}

function extractTitle(body: string, fallback: string): string {
  const m = body.match(/^#\s+(.+?)\s*$/m);
  return (m ? m[1] : fallback).slice(0, 200);
}

/** Parse the leading `---…---` block from raw file content.
 *  Returns { fields, body } where fields is a Map of key→raw-value lines
 *  and body is everything after the closing `---`.
 */
function parseFrontmatter(raw: string): {
  hasBlock: boolean;
  fields: Map<string, string>;
  body: string;
} {
  if (!raw.startsWith('---\n')) {
    return { hasBlock: false, fields: new Map(), body: raw };
  }
  const end = raw.indexOf('\n---\n', 4);
  if (end === -1) {
    return { hasBlock: false, fields: new Map(), body: raw };
  }
  const block = raw.slice(4, end); // content between the ---
  const after = raw.slice(end + 5); // everything after closing ---
  const fields = new Map<string, string>();
  for (const line of block.split('\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
  }
  return { hasBlock: true, fields, body: after };
}

/** Build a new frontmatter block string (including leading and trailing ---). */
function buildFrontmatter(
  fields: Map<string, string>,
  id: string,
  title: string,
  type: DocType,
  status: 'active' | 'archived',
  tags: string[],
  createdAt: string,
  updatedAt: string,
): string {
  // Collect extra fields we want to preserve (template_id etc.).
  const extraKeys = ['template_id', 'template_name'];
  const extra = extraKeys
    .filter((k) => fields.has(k))
    .map((k) => `${k}: ${fields.get(k)!}`);

  const lines = [
    '---',
    `id: ${id}`,
    `title: ${JSON.stringify(title)}`,
    `project: ${PROJECT_ID}`,
    `type: ${type}`,
    `status: ${status}`,
    `created_at: "${createdAt}"`,
    `updated_at: "${updatedAt}"`,
    `tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]`,
    ...extra,
    '---',
    '',
  ];
  return lines.join('\n');
}

async function walkMarkdown(root: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) {
        // Follow one level of symlinks for the project root itself but
        // don't recurse into nested symlinks to avoid cycles.
        continue;
      }
      if (e.isDirectory()) await visit(full);
      else if (e.isFile() && e.name.endsWith('.md')) out.push(full);
    }
  }
  await visit(root);
  out.sort();
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const db = openDatabase({ file: dbFile });
  try {
    // 1. Upsert project row.
    const now = new Date().toISOString();
    const exists =
      db
        .prepare<[string], { c: number }>(`SELECT 1 AS c FROM projects WHERE id = ?`)
        .get(PROJECT_ID)?.c === 1;

    if (exists) {
      db.prepare(`UPDATE projects SET name = ?, updated_at = ? WHERE id = ?`).run(
        PROJECT_NAME,
        now,
        PROJECT_ID,
      );
      console.log(`[register-docs] project '${PROJECT_ID}' updated in DB.`);
    } else {
      db.prepare(
        `INSERT INTO projects (id, name, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        PROJECT_ID,
        PROJECT_NAME,
        'Repository documentation — symlinked from docs/.',
        now,
        now,
      );
      console.log(`[register-docs] project '${PROJECT_ID}' inserted into DB.`);
    }

    // 2. Walk files and stamp frontmatter where missing.
    const files = await walkMarkdown(projectDir);
    let stamped = 0;
    let skipped = 0;

    for (const abs of files) {
      const raw = await fs.readFile(abs, 'utf8');
      const { hasBlock, fields, body } = parseFrontmatter(raw);

      // If the file already has a valid UUID id field, leave it alone.
      const existingId = fields.get('id') ?? '';
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidPattern.test(existingId)) {
        // Already registered — ensure project field is correct but otherwise skip.
        if (fields.get('project') === PROJECT_ID) {
          skipped += 1;
          continue;
        }
      }

      const rel = path.relative(projectDir, abs);
      const { type, tags, status } = classify(rel);
      const fallback = path.basename(abs, '.md').replace(/[-_]+/g, ' ');
      const title = extractTitle(hasBlock ? body : raw, fallback);

      const fileStat = await fs.stat(abs);
      const id = uuidPattern.test(existingId) ? existingId : randomUUID();
      const createdAt = fileStat.birthtime.toISOString();
      const updatedAt = fileStat.mtime.toISOString();

      const fm = buildFrontmatter(fields, id, title, type, status, tags, createdAt, updatedAt);
      await fs.writeFile(abs, fm + (hasBlock ? body : `\n${raw}`), 'utf8');
      stamped += 1;
    }

    console.log(
      `[register-docs] frontmatter: stamped=${stamped} already-ok=${skipped} total=${files.length}`,
    );

    // 3. Reindex so documents are queryable immediately.
    const ctx = buildContext({ db, dataDir });
    const report = await ctx.reindexService.runProject(PROJECT_ID);
    console.log(
      `[register-docs] reindex: added=${report.added} updated=${report.updated} removed=${report.removed} skipped=${report.skipped.length} (${report.durationMs} ms)`,
    );
    if (report.skipped.length > 0) {
      console.log('[register-docs] skipped files:', report.skipped);
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
