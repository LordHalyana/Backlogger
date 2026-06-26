import { test, expect } from '@playwright/test';
import { createProject } from './helpers.js';

/**
 * Folder management e2e:
 *   create project → add a folder via the sidebar → create a doc in
 *   that folder via NewDocumentDialog → toggle Manage mode → delete
 *   the (now empty) folder via the × button.
 */
test('user can create a folder, place a doc in it, and delete it once empty', async ({
  page,
}) => {
  const projectId = `folders-${Date.now()}`;
  const projectName = `Folders ${projectId}`;
  const folderName = `phases/p${Math.floor(Math.random() * 1000)}/blocks`;
  const docTitle = 'Folder Doc';

  await page.goto('/');

  // ── Create the project ─────────────────────────────────────────────
  await createProject(page, { id: projectId, name: projectName });

  // ── Add a folder via the sidebar toolbar (window.prompt) ────────────
  page.once('dialog', (d) => d.accept(folderName));
  await page.getByRole('button', { name: 'Add folder', exact: true }).click();

  // The folder shows up in the tree as a group header.
  const tree = page.locator('.project-tree');
  await expect(tree.locator('.folder-name', { hasText: folderName })).toBeVisible();

  // ── Create a doc inside that folder via NewDocumentDialog ──────────
  await page.getByRole('button', { name: '+ New', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Document' });
  await dialog.getByLabel('Document type').selectOption('note');
  await dialog.getByLabel('Document folder').selectOption(folderName);
  await dialog.getByLabel('Document title').fill(docTitle);
  await dialog.getByRole('button', { name: 'Create' }).click();

  // Doc opens in the editor and is listed under the folder.
  await expect(page.locator('.cm-content')).toBeVisible();
  const folderRow = tree
    .locator('.tree-group')
    .filter({ has: page.locator('.folder-name', { hasText: folderName }) });
  await expect(folderRow.getByRole('button', { name: new RegExp(docTitle) })).toBeVisible();

  // ── Manage mode shows × buttons; deleting non-empty is disabled ────
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  const deleteBtn = folderRow.getByRole('button', { name: `Delete folder ${folderName}` });
  await expect(deleteBtn).toBeVisible();
  await expect(deleteBtn).toBeDisabled();

  // ── Delete the doc, then the folder becomes deletable ──────────────
  // Cheap path: round-trip via the API (UI doesn't expose doc delete in tree).
  const docPaths = await page.evaluate(async (pid) => {
    const res = await fetch(`/api/projects/${pid}/documents`);
    return (await res.json()) as Array<{ id: string }>;
  }, projectId);
  expect(docPaths.length).toBe(1);
  await page.evaluate(
    async ({ id }) => {
      await fetch(`/api/documents/${id}`, { method: 'DELETE' });
    },
    { id: docPaths[0].id },
  );

  // Force a reload of the project so the tree sees the deletion.
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.locator('.app-toast.ok')).toBeVisible();

  // Re-enter manage mode (UI may have re-rendered) and delete the empty folder.
  const manageBtn = page.getByRole('button', { name: /Manage|Done/, exact: true });
  // If we're in "Done" mode, stay; otherwise click to enter manage.
  if ((await manageBtn.textContent())?.trim() === 'Manage') {
    await manageBtn.click();
  }

  page.once('dialog', (d) => d.accept());
  const folderRow2 = tree
    .locator('.tree-group')
    .filter({ has: page.locator('.folder-name', { hasText: folderName }) });
  await folderRow2.getByRole('button', { name: `Delete folder ${folderName}` }).click();

  // The folder is gone from the tree.
  await expect(tree.locator('.folder-name', { hasText: folderName })).toHaveCount(0);
});
