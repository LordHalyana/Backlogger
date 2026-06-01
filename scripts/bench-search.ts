#!/usr/bin/env -S node --experimental-strip-types
/**
 * Search bench (P2 Block 1).
 *
 * Seeds a synthetic corpus into a throwaway data directory, then runs N
 * search queries and reports p50/p95/p99 latencies. The corpus and DB live
 * under <os.tmpdir()>/backlogger-bench-<uuid> and are removed afterwards.
 *
 * Usage:
 *   tsx scripts/bench-search.ts [--docs=1000] [--queries=100] [--p95-budget=200]
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../packages/api/src/db/database.ts';
import { buildContext } from '../packages/api/src/context.ts';

interface Args {
  docs: number;
  queries: number;
  p95Budget: number | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { docs: 1000, queries: 100, p95Budget: null };
  for (const arg of argv) {
    const m = /^--([a-z0-9-]+)=(.+)$/.exec(arg);
    if (!m) continue;
    const [, key, val] = m;
    if (key === 'docs') out.docs = Number(val);
    else if (key === 'queries') out.queries = Number(val);
    else if (key === 'p95-budget') out.p95Budget = Number(val);
  }
  return out;
}

const WORDS = [
  'rate', 'limit', 'cache', 'token', 'bucket', 'stampede', 'replica', 'shard',
  'queue', 'index', 'snapshot', 'consensus', 'leader', 'follower', 'gossip',
  'retry', 'backoff', 'timeout', 'deadline', 'idempotent', 'graph', 'edge',
  'node', 'partition', 'rebalance', 'commit', 'rollback', 'transaction',
  'isolation', 'snapshot', 'wal', 'checkpoint', 'compaction', 'tombstone',
];

function randWord(): string {
  return WORDS[Math.floor(Math.random() * WORDS.length)]!;
}

function makeBody(): string {
  const lines: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    const line: string[] = [];
    for (let j = 0; j < 12; j += 1) line.push(randWord());
    lines.push(line.join(' '));
  }
  return lines.join('\n');
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-bench-'));
  const dataDir = path.join(tmp, 'data');
  await fs.mkdir(dataDir, { recursive: true });

  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(here, '..', 'migrations');
  const db = openDatabase({ file: path.join(tmp, 'bench.sqlite'), migrationsDir });

  try {
    const ctx = buildContext({ db, dataDir });
    await ctx.fs.ensureRoot();
    await ctx.projectService.create({ id: 'bench', name: 'Bench' });

    console.log(`[bench] seeding ${args.docs} documents...`);
    const seedStart = Date.now();
    for (let i = 0; i < args.docs; i += 1) {
      await ctx.documentService.create('bench', {
        title: `Doc ${i} ${randWord()} ${randWord()}`,
        type: 'note',
        body: makeBody(),
      });
    }
    console.log(`[bench] seeded in ${((Date.now() - seedStart) / 1000).toFixed(1)}s`);

    const samples: number[] = [];
    let hits = 0;
    for (let i = 0; i < args.queries; i += 1) {
      const q = `${randWord()} ${randWord()}`;
      const t0 = process.hrtime.bigint();
      const results = ctx.searchService.search(q, { limit: 50 });
      const t1 = process.hrtime.bigint();
      samples.push(Number(t1 - t0) / 1e6);
      hits += results.length;
    }
    samples.sort((a, b) => a - b);
    const p50 = percentile(samples, 50);
    const p95 = percentile(samples, 95);
    const p99 = percentile(samples, 99);

    console.log(
      `[bench] queries=${args.queries} avg_hits=${(hits / args.queries).toFixed(1)}`,
    );
    console.log(
      `[bench] p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms`,
    );

    if (args.p95Budget !== null) {
      if (p95 > args.p95Budget) {
        console.error(`[bench] FAIL p95 ${p95.toFixed(2)}ms exceeds budget ${args.p95Budget}ms`);
        process.exitCode = 1;
      } else {
        console.log(`[bench] OK p95 within budget ${args.p95Budget}ms`);
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
