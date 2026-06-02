#!/usr/bin/env -S node --experimental-strip-types
/**
 * Knowledge-graph bench (P5 Block 5).
 *
 * Seeds a synthetic corpus with random wiki-links, then calls
 * GraphService.getGraph() N times (cache bypassed via invalidate before each
 * call) and reports p50/p95/p99 latencies.
 *
 * Usage:
 *   tsx scripts/bench-graph.ts [--docs=1000] [--links=5000] [--queries=50] [--p95-budget=50]
 *
 * Exit codes:
 *   0 — within budget (or no budget specified)
 *   1 — over budget or setup failed
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../packages/api/src/db/database.ts';
import { buildContext } from '../packages/api/src/context.ts';

interface Args {
  docs: number;
  links: number;
  queries: number;
  p95Budget: number | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { docs: 1000, links: 5000, queries: 50, p95Budget: null };
  for (const arg of argv) {
    const m = /^--([a-z0-9-]+)=(.+)$/.exec(arg);
    if (!m) continue;
    const [, key, val] = m;
    if (key === 'docs') out.docs = Number(val);
    else if (key === 'links') out.links = Number(val);
    else if (key === 'queries') out.queries = Number(val);
    else if (key === 'p95-budget') out.p95Budget = Number(val);
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-bench-graph-'));
  const dataDir = path.join(tmp, 'data');
  await fs.mkdir(dataDir, { recursive: true });

  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(here, '..', 'migrations');
  const db = openDatabase({ file: path.join(tmp, 'bench.sqlite'), migrationsDir });

  try {
    const ctx = buildContext({ db, dataDir });
    await ctx.fs.ensureRoot();
    await ctx.projectService.create({ id: 'bench', name: 'Bench' });

    // ── Seed documents ──────────────────────────────────────────────────────
    console.log(`[bench-graph] seeding ${args.docs} documents...`);
    const seedStart = Date.now();
    const titles: string[] = [];
    for (let i = 0; i < args.docs; i += 1) {
      const title = `Doc ${i}`;
      await ctx.documentService.create('bench', { title, type: 'note', body: '' });
      titles.push(title);
    }
    console.log(`[bench-graph] docs seeded in ${((Date.now() - seedStart) / 1000).toFixed(1)}s`);

    // ── Seed links ───────────────────────────────────────────────────────────
    console.log(`[bench-graph] seeding ${args.links} random links...`);
    const linkStart = Date.now();
    // Insert links directly via SQL for speed (avoids FS round-trips).
    const insertLink = db.prepare(
      `INSERT OR IGNORE INTO links
         (source_id, target_id, target_title, target_title_norm, display, position)
       SELECT d1.id, d2.id, d2.title, lower(d2.title), d2.title, ?
       FROM documents d1, documents d2
       WHERE d1.title = ? AND d2.title = ? AND d1.id != d2.id`,
    );
    const insertMany = db.transaction(() => {
      for (let i = 0; i < args.links; i += 1) {
        const src = titles[Math.floor(Math.random() * titles.length)]!;
        const tgt = titles[Math.floor(Math.random() * titles.length)]!;
        insertLink.run(i, src, tgt);
      }
    });
    insertMany();
    console.log(`[bench-graph] links seeded in ${((Date.now() - linkStart) / 1000).toFixed(1)}s`);

    // ── Bench ────────────────────────────────────────────────────────────────
    console.log(`[bench-graph] running ${args.queries} graph queries...`);
    const samples: number[] = [];
    for (let i = 0; i < args.queries; i += 1) {
      // Bypass the LRU cache so each query exercises the SQL path.
      ctx.graphService.invalidate('bench');
      const t0 = process.hrtime.bigint();
      ctx.graphService.getGraph('bench');
      const t1 = process.hrtime.bigint();
      samples.push(Number(t1 - t0) / 1e6);
    }
    samples.sort((a, b) => a - b);
    const p50 = percentile(samples, 50);
    const p95 = percentile(samples, 95);
    const p99 = percentile(samples, 99);

    // Report node/edge counts from a final cached call.
    const payload = ctx.graphService.getGraph('bench');
    console.log(
      `[bench-graph] nodes=${payload.nodes.length} edges=${payload.edges.length}`,
    );
    console.log(
      `[bench-graph] p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms`,
    );

    if (args.p95Budget !== null) {
      if (p95 > args.p95Budget) {
        console.error(
          `[bench-graph] FAIL p95 ${p95.toFixed(2)}ms exceeds budget ${args.p95Budget}ms`,
        );
        process.exitCode = 1;
      } else {
        console.log(`[bench-graph] OK p95 within budget ${args.p95Budget}ms`);
      }
    }
  } finally {
    db.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
