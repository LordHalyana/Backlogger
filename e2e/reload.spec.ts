import { test, expect } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const DATA_DIR = process.env.BACKLOGGER_DATA_DIR ?? path.resolve(process.cwd(), '.e2e-data');

/**
 * Block 6 (Project Reload) e2e:
 *   create project + doc → modify the on-disk `.md` directly →
 *   click topbar Reload → expect a success toast and the new body
 *   to show up after re-opening the doc.
 */
test('topbar Reload picks up an out-of-band edit on disk', async ({ page }) => {
  const projectId = `reload-${Date.now()}`;
  const projectName = `Reload ${projectId}`;
  const docTitle = 'Reload Doc';
  const newBodyToken = 'RELOAD-TOKEN-XYZ';

  await page.goto('/');

  await page.getByRole('button', { name: '+ New Project' }).click();
  await page.getByLabel('ID').fill(projectId);
  await page.getByLabel('Name', { exact: true }).fill(projectName);
  await page.getByRole('button', { name: 'Create' }).click();

  await page.getByRole('button', { name: '+ New', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Document' });
  await dialog.getByLabel('Type').selectOption('note');
  await dialog.getByLabel('Title').fill(docTitle);
  await page.getByRole('button', { name: 'Create' }).click();

  // Wait until the editor is mounted with the new doc so the file is on disk.
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();

  // The file is `<slug>-<8hex>.md`; slug for "Reload Doc" is `reload-doc`.
  const notesDir = path.join(DATA_DIR, 'projects', projectId, 'notes');
  let mdFile: string | undefined;
  for (let i = 0; i < 50; i++) {
    const entries = await fs.readdir(notesDir).catch(() => []);
    mdFile = entries.find((f) => /^reload-doc-[0-9a-f]{8}\.md$/.test(f));
    if (mdFile) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(mdFile, 'expected reload-doc-*.md on disk').toBeTruthy();

  // Append the token to the body, preserving the frontmatter block intact.
  const filePath = path.join(notesDir, mdFile!);
  const original = await fs.readFile(filePath, 'utf8');
  await fs.writeFile(filePath, `${original.replace(/\s*$/, '')}\n\n${newBodyToken}\n`, 'utf8');

  // Click Reload and wait for the toast.
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  const toast = page.locator('.app-toast.ok');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(`Reloaded ${projectId}`);

  // The document query is invalidated → editor rebases on the new body.
  await expect(editor).toContainText(newBodyToken);
});
