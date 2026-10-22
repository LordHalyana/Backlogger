#!/usr/bin/env -S node --experimental-strip-types
/**
 * Coordinated-write bench (spec #58 release gate).
 *
 * Posts N comments through CommentService.create(), the write-coordinator
 * path (intent transaction, durable file write with directory fsync,
 * completion transaction), and reports p50/p95/p99 latencies. Runs once with
 * the shipped `synchronous=FULL` and once with `synchronous=NORMAL`, so the
 * cost of FULL is measured rather than assumed. The budget applies to FULL.
 *
 * The data dir lives under os.tmpdir(). fsync is nearly free on tmpfs, so
 * point TMPDIR at the disk you deploy on to get a meaningful number.
 *
 * The FULL-minus-NORMAL delta compares two separate runs, so it is noisy and
 * can come out negative. A comment post is a single-file write; filing and
 * deletion fsync more often, so treat the measured cost as a lower bound.
 *
 * Usage:
 *   tsx scripts/bench-writes.ts [--writes=200] [--p95-budget=200]
 *
 * Exit codes:
 *   0 — within budget (or no budget specified)
 *   1 — over budget or setup failed
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import { buildContext } from '../packages/api/src/context.ts';
import { createBenchContext, percentile } from './lib/bench.ts';

interface Args {
  writes: number;
  p95Budget: number | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { writes: 200, p95Budget: null };
  for (const arg of argv) {
    const m = /^--([a-z0-9-]+)=(.+)$/.exec(arg);
    if (!m) continue;
    const [, key, val] = m;
    if (key === 'writes') out.writes = Number(val);
    else if (key === 'p95-budget') out.p95Budget = Number(val);
  }
  return out;
}

async function run(mode: 'FULL' | 'NORMAL', writes: number): Promise<number> {
  const { db, tmp, dataDir } = await createBenchContext('backlogger-bench-writes-');
  try {
    db.pragma(`synchronous = ${mode}`);
    const ctx = buildContext({ db, dataDir });
    await ctx.fs.ensureRoot();
    await ctx.projectService.create({ id: 'bench', name: 'Bench' });
    const task = await ctx.documentService.create('bench', {
      title: 'Bench task',
      type: 'backlog_item',
      body: '',
    });

    const samples: number[] = [];
    for (let i = 0; i < writes; i += 1) {
      const t0 = process.hrtime.bigint();
      await ctx.commentService.create({
        operationId: crypto.randomUUID(),
        taskId: task.id,
        commentId: crypto.randomUUID(),
        body: `Bench comment ${i}\n\n- a finding\n- a decision\n`,
      });
      const t1 = process.hrtime.bigint();
      samples.push(Number(t1 - t0) / 1e6);
    }
    samples.sort((a, b) => a - b);
    const p50 = percentile(samples, 50);
    const p95 = percentile(samples, 95);
    const p99 = percentile(samples, 99);
    console.log(
      `[bench-writes] synchronous=${mode} writes=${writes} p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms`,
    );
    return p95;
  } finally {
    db.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const full = await run('FULL', args.writes);
  const normal = await run('NORMAL', args.writes);
  console.log(`[bench-writes] FULL costs ${(full - normal).toFixed(2)}ms at p95 over NORMAL`);

  if (args.p95Budget !== null) {
    if (full > args.p95Budget) {
      console.error(
        `[bench-writes] FAIL p95 ${full.toFixed(2)}ms exceeds budget ${args.p95Budget}ms`,
      );
      process.exitCode = 1;
    } else {
      console.log(`[bench-writes] OK p95 within budget ${args.p95Budget}ms`);
    }
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
