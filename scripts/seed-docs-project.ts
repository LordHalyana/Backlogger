#!/usr/bin/env -S npx tsx
/**
 * Demo-only seed for a `backlogger-docs` project from the repository's
 * `docs/` tree. This wipes the existing project folder + DB row before
 * recreating from scratch.
 *
 * Prefer `npm run register-docs` for normal local dogfooding. That workflow
 * uses the docs/ folder in place and matches the mounted-docs model.
 *
 * Layout mirrors the on-disk `docs/` hierarchy 1:1 using Backlogger's
 * arbitrary-folder feature:
 *
 *   docs/README.md          → (project root)/readme.md
 *   docs/design/overview.md → design/overview.md
 *   docs/p3/blocks/block-1-search.md → p3/blocks/block-1-search.md
 *   docs/findings/search-audit.md → findings/search-audit.md
 *
 * After running, this script invokes a project reindex so the new files
 * are visible immediately — no server restart needed.
 */
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../packages/api/src/db/database.ts';
import { buildContext } from '../packages/api/src/context.ts';
import { type DocType, extractTitle, walkMarkdown } from './lib/docs-project.ts';

const PROJECT_ID = 'backlogger-docs';
const PROJECT_NAME = 'Backlogger Documentation';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
// Default to the same directory the API server uses. `npm -w @backlogger/api
// run dev` runs the server with cwd=packages/api/, so its `./data` default
// resolves to `packages/api/data/`. Match that here unless the caller sets
// BACKLOGGER_DATA_DIR explicitly.
const dataDir = path.resolve(
  process.env.BACKLOGGER_DATA_DIR ?? path.join(repoRoot, 'packages', 'api', 'data'),
);
const docsDir = path.join(repoRoot, 'docs');
const projectDir = path.join(dataDir, 'projects', PROJECT_ID);
const dbFile = path.join(dataDir, 'backlogger.sqlite');

function slugSegment(seg: string): string {
  return seg
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
}

/** Map `docs/<rel>` → `<projectFolder>` (forward-slash, empty for root). */
function projectFolder(rel: string): string {
  const dir = path.dirname(rel).replace(/\\/g, '/');
  if (dir === '.' || dir === '') return '';
  const segments = dir.split('/');
  return segments.map(slugSegment).join('/');
}

function classify(rel: string): { type: DocType; tags: string[] } {
  const parts = rel.split(path.sep);
  const tags = new Set<string>();
  if (parts[0] && parts[0] !== 'README.md') tags.add(parts[0].toLowerCase());

  if (/implementation_plan\.md$/i.test(rel) || /\broadmap\.md$/i.test(rel)) {
    return { type: 'implementation_plan', tags: [...tags] };
  }
  if (
    parts[0] === 'design' ||
    /\bdesign\.md$/i.test(rel) ||
    parts.includes('blocks')
  ) {
    return { type: 'design_doc', tags: [...tags] };
  }
  if (parts[0] === 'findings') tags.add('findings');
  if (parts[0] === 'operations') tags.add('operations');
  return { type: 'note', tags: [...tags] };
}

function slugifyName(rel: string): string {
  const base = path.basename(rel, '.md').toLowerCase();
  let s = base
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  if (!/^[a-z0-9]/.test(s)) s = `doc-${s}`;
  return `${s.slice(0, 124)}.md`;
}

async function main(): Promise<void> {
  // 1. Reset project folder.
  await fs.rm(projectDir, { recursive: true, force: true });
  await fs.mkdir(projectDir, { recursive: true });

  // 2. Reset DB row (and document/link/tag rows via FK cascade).
  const db = openDatabase({ file: dbFile });
  try {
    db.prepare(`DELETE FROM projects WHERE id = ?`).run(PROJECT_ID);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO projects (id, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      PROJECT_ID,
      PROJECT_NAME,
      'Repository documentation, loaded as a Backlogger project.',
      now,
      now,
    );

    // 3. Walk docs and write each as a frontmatter-prefixed file under the
    //    mirrored folder.
    const files = await walkMarkdown(docsDir);
    const usedPaths = new Set<string>();
    let written = 0;
    for (const abs of files) {
      const rel = path.relative(docsDir, abs);
      const raw = await fs.readFile(abs, 'utf8');
      const { type, tags } = classify(rel);

      // Strip any pre-existing frontmatter block so we own it.
      let body = raw;
      if (body.startsWith('---\n')) {
        const end = body.indexOf('\n---', 4);
        if (end !== -1) body = body.slice(end + 4).replace(/^\n/, '');
      }

      const title = extractTitle(body, rel);
      const folder = projectFolder(rel);
      let name = slugifyName(rel);
      let target = folder ? `${folder}/${name}` : name;
      while (usedPaths.has(target)) {
        name = name.replace(/\.md$/, `-${Math.random().toString(36).slice(2, 6)}.md`);
        target = folder ? `${folder}/${name}` : name;
      }
      usedPaths.add(target);

      const id = randomUUID();
      const stat = await fs.stat(abs);
      const created = stat.birthtime.toISOString();
      const updated = stat.mtime.toISOString();

      const fm = [
        '---',
        `id: ${id}`,
        `title: ${JSON.stringify(title)}`,
        `project: ${PROJECT_ID}`,
        `type: ${type}`,
        `status: active`,
        `created_at: "${created}"`,
        `updated_at: "${updated}"`,
        `tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]`,
        '---',
        '',
      ].join('\n');

      const absTarget = path.join(projectDir, target);
      await fs.mkdir(path.dirname(absTarget), { recursive: true });
      await fs.writeFile(absTarget, fm + body, 'utf8');
      written += 1;
    }

    // eslint-disable-next-line no-console
    console.log(
      `[seed-docs] project '${PROJECT_ID}' created at ${projectDir}; wrote ${written} document(s).`,
    );

    // 4. Index the new files so the project is visible immediately.
    const ctx = buildContext({ db, dataDir });
    const report = await ctx.reindexService.runProject(PROJECT_ID);
    // eslint-disable-next-line no-console
    console.log(
      `[seed-docs] indexed: added=${report.added} updated=${report.updated} removed=${report.removed} skipped=${report.skipped.length} (${report.durationMs} ms)`,
    );
    if (report.skipped.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[seed-docs] skipped:', report.skipped);
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
