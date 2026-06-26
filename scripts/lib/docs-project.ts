import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Document type assigned to a docs-tree file. */
export type DocType = 'design_doc' | 'implementation_plan' | 'note';

/** First `# heading` of the body, else `fallback`, capped at 200 chars. */
export function extractTitle(body: string, fallback: string): string {
  const m = body.match(/^#\s+(.+?)\s*$/m);
  return (m?.[1] ?? fallback).slice(0, 200);
}

/** Recursively collect `.md` file paths under `root`, sorted ascending. */
export async function walkMarkdown(
  root: string,
  opts: { skipSymlinks?: boolean } = {},
): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (opts.skipSymlinks && e.isSymbolicLink()) continue;
      if (e.isDirectory()) await visit(full);
      else if (e.isFile() && e.name.endsWith('.md')) out.push(full);
    }
  }
  await visit(root);
  out.sort();
  return out;
}
