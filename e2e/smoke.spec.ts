import { test, expect } from '@playwright/test';
import { createProject, createDocument } from './helpers.js';

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
  await createProject(page, { id: projectId, name: projectName });

  // Project should auto-select. Open the new-document dialog.
  await createDocument(page, { title: docTitle, type: 'design_doc', template: 'design-document' });

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
