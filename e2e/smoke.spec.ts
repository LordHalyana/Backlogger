import { test, expect } from '@playwright/test';

/**
 * Smoke flow (exit criterion for P1 Block 6, kept as regression guard):
 *
 *   create project → create design doc from template → edit body →
 *   reload → content intact.
 */
test('create project, create doc from template, edit, reload, content intact', async ({
  page,
}) => {
  const projectId = `smoke-${Date.now()}`;
  const projectName = `Smoke ${projectId}`;
  const docTitle = 'Smoke Doc';
  const extraText = ' EXTRA-EDIT-TOKEN';

  await page.goto('/');

  // Create project.
  await page.getByRole('button', { name: '+ New Project' }).click();
  await page.getByLabel('ID').fill(projectId);
  await page.getByLabel('Name', { exact: true }).fill(projectName);
  await page.getByRole('button', { name: 'Create' }).click();

  // Project should auto-select. Open the new-document dialog.
  await page.getByRole('button', { name: '+ New', exact: true }).click();

  // Pick design_doc type so the design-document template is available.
  const newDocDialog = page.getByRole('dialog', { name: 'New Document' });
  await newDocDialog.getByLabel('Type').selectOption('design_doc');
  await newDocDialog.getByLabel('Template').selectOption('design-document');
  await newDocDialog.getByLabel('Title').fill(docTitle);
  await page.getByRole('button', { name: 'Create' }).click();

  // Editor opens with template body. Append extra text.
  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('Purpose');
  await editor.click();
  await page.keyboard.press('End');
  await editor.pressSequentially(extraText, { delay: 20 });

  // Wait for autosave: status flips Unsaved changes -> Saving… -> Saved.
  // Match the exact .status-label text so "Unsaved changes" doesn't
  // case-insensitively satisfy a substring match on "Saved".
  const status = page.locator('.status-label');
  await expect(status).toHaveText('Unsaved changes', { timeout: 3000 });
  await expect(status).toHaveText('Saved', { timeout: 5000 });

  // Reload and reopen the document.
  await page.reload();
  // Re-select the project after reload (client state is reset).
  await page.locator('#project-select').selectOption(projectId);
  await page.locator('button.tree-item').filter({ hasText: docTitle }).click();
  const editor2 = page.locator('.cm-content');
  await expect(editor2).toContainText('Purpose');
  await expect(editor2).toContainText(extraText.trim());
});
