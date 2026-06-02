#!/usr/bin/env -S node --experimental-strip-types
/**
 * Bundle audit (P2 Block 5).
 *
 * Reads the Vite build output in packages/web/dist/assets/, computes gzip
 * sizes, and fails if the initial JS chunk (matched by /^index-.*\.js$/)
 * exceeds the budget.
 *
 * Usage:
 *   npm run bundle-audit [-- --budget=200]
 *   tsx scripts/bundle-audit.ts [--budget=200]
 *
 * Exit codes:
 *   0 — within budget
 *   1 — over budget or dist/ not found
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'packages', 'web', 'dist', 'assets');

function parseArgs(): { budget: number } {
  let budget = 220; // P5 raised from 200 kB (P2) to 220 kB to fit react-force-graph-2d
  for (const arg of process.argv.slice(2)) {
    const m = /^--budget=(\d+)$/.exec(arg);
    if (m) budget = Number(m[1]);
  }
  return { budget };
}

function gzipSize(filePath: string): number {
  const content = fs.readFileSync(filePath);
  return zlib.gzipSync(content, { level: 9 }).length;
}

const { budget } = parseArgs();

if (!fs.existsSync(distDir)) {
  console.error('[bundle-audit] dist/assets not found — run npm run build first.');
  process.exit(1);
}

const files = fs.readdirSync(distDir);
const initialChunk = files.find((f) => /^index-.*\.js$/.test(f));

if (!initialChunk) {
  console.error('[bundle-audit] No initial chunk matching index-*.js found in dist/assets.');
  process.exit(1);
}

const chunkPath = path.join(distDir, initialChunk);
const gzipBytes = gzipSize(chunkPath);
const gzipKB = (gzipBytes / 1024).toFixed(2);
const budgetKB = budget;
const ok = gzipBytes / 1024 <= budgetKB;

const verdict = ok ? '✅' : '❌';
console.log(
  `[bundle-audit] initial=${gzipKB}kB gzip (budget ${budgetKB}kB) ${verdict}`,
);

if (!ok) {
  console.error(
    `[bundle-audit] FAIL: initial chunk ${gzipKB}kB exceeds ${budgetKB}kB budget.`,
  );
  process.exit(1);
}
