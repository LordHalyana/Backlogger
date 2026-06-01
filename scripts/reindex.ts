#!/usr/bin/env -S node --experimental-strip-types
/**
 * Reindex summary script (Block 1).
 *
 * Walks `<BACKLOGGER_DATA_DIR>/projects/` and prints counts per project and
 * per `type` frontmatter value. In later blocks this script will also
 * rebuild the SQLite `documents` table; for now it is a read-only summary
 * to confirm the filesystem layer works end-to-end.
 */
import { PathResolver, FsRepository } from '../packages/api/src/fs/index.ts';

const dataDir = process.env.BACKLOGGER_DATA_DIR ?? './data';

async function main(): Promise<void> {
  const resolver = new PathResolver({ dataDir });
  const repo = new FsRepository({ resolver });
  await repo.ensureRoot();

  const perProject = new Map<string, number>();
  const perType = new Map<string, number>();
  let total = 0;

  for await (const doc of repo.walk()) {
    total += 1;
    const projectId = doc.path.split('/')[0] ?? '<unknown>';
    perProject.set(projectId, (perProject.get(projectId) ?? 0) + 1);
    const type = typeof doc.frontmatter.type === 'string' ? doc.frontmatter.type : '<missing>';
    perType.set(type, (perType.get(type) ?? 0) + 1);
  }

  // eslint-disable-next-line no-console
  console.log(`Reindex summary (${resolver.projectsRoot})`);
  // eslint-disable-next-line no-console
  console.log(`  total documents: ${total}`);
  // eslint-disable-next-line no-console
  console.log('  by project:');
  for (const [k, v] of [...perProject.entries()].sort()) {
    // eslint-disable-next-line no-console
    console.log(`    ${k}: ${v}`);
  }
  // eslint-disable-next-line no-console
  console.log('  by type:');
  for (const [k, v] of [...perType.entries()].sort()) {
    // eslint-disable-next-line no-console
    console.log(`    ${k}: ${v}`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
