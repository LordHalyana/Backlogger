import { test, expect } from '@playwright/test';
import { createProject, createDocument, expectSaved } from './helpers.js';

/**
 * Full-text search (Block 1):
 *
 *   create project → create three docs, one with a unique phrase →
 *   open command palette → search the unique phrase → click result →
 *   assert correct doc opens in editor.
 */
test('search unique phrase opens the correct document', async ({ page }) => {
  const projectId = `search-${Date.now()}`;
  const uniquePhrase = `xyzzy-search-token-${Date.now()}`;

  await page.goto('/');

  // Create project.
  await createProject(page, { id: projectId });

  // Create a "noise" doc (should not appear in results).
  await createDocument(page, { title: 'Noise Doc One' });
  await expectSaved(page);

  // Create the target doc containing the unique phrase.
  await createDocument(page, { title: 'Target Document' });
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('End');
  await editor.pressSequentially(' ' + uniquePhrase, { delay: 20 });
  // Confirm the edit was captured before waiting for autosave.
  await expect(page.locator('.status-label')).toHaveText('Unsaved changes', { timeout: 3000 });
  await expectSaved(page);

  // Create another noise doc.
  await createDocument(page, { title: 'Noise Doc Two' });
  await expectSaved(page);

  // Open command palette via topbar Search button.
  await page.locator('.search-button').click();
  await expect(page.getByRole('dialog', { name: 'Search documents' })).toBeVisible();

  // Type the unique phrase (use pressSequentially to reliably trigger React onChange).
  const paletteInput = page.locator('.command-palette-input');
  await paletteInput.click();
  await paletteInput.pressSequentially(uniquePhrase);

  // One result should appear.
  const results = page.locator('.command-palette-row');
  await expect(results).toHaveCount(1, { timeout: 8000 });
  await expect(results.first()).toContainText('Target Document');

  // Click the result.
  await results.first().click();

  // The editor should open and show the document.
  await expect(page.locator('.cm-content')).toContainText(uniquePhrase, { timeout: 3000 });
});

test('command palette opens with Ctrl+K and closes with Escape', async ({ page }) => {
  await page.goto('/');

  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Search documents' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Search documents' })).not.toBeVisible();
});

/**
 * Comment search (#70): a task is found through the text of a comment posted
 * in the Comments tab, even when the same query ran before the comment
 * existed, and its row carries the Comment match chip.
 */
test('finds a task through its comment text', async ({ page }) => {
  const projectId = `comment-search-${Date.now()}`;
  const phrase = `plugh${Date.now()}`;
  const project = await page.request.post('/api/projects', {
    data: { id: projectId, name: projectId },
  });
  expect(project.ok(), await project.text()).toBe(true);
  const doc = await page.request.post(`/api/projects/${projectId}/documents`, {
    data: { title: 'Track down the stale cache', type: 'backlog_item' },
  });
  expect(doc.ok()).toBe(true);
  const { id: taskId } = (await doc.json()) as { id: string };

  await page.goto(`/projects/${projectId}/documents/${taskId}`);
  const dialog = page.getByRole('dialog', { name: 'Search documents' });
  const paletteInput = page.locator('.command-palette-input');
  const results = page.locator('.command-palette-row');

  // Nothing matches yet; this result is cached by the palette.
  await page.locator('.search-button').click();
  await paletteInput.pressSequentially(phrase);
  await expect(dialog.getByText('No results.')).toBeVisible({ timeout: 8000 });
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Comments (0)' }).click();
  const composer = page.getByRole('textbox', { name: 'New comment' });
  await composer.fill(`Found it: the ${phrase} key never expires.`);
  await composer.press('Control+Enter');
  await expect(page.getByTestId('comments-live')).toHaveText('Comment posted.');

  await page.locator('.search-button').click();
  await paletteInput.pressSequentially(phrase);
  await expect(results).toHaveCount(1, { timeout: 8000 });
  const row = results.first();
  await expect(row).toContainText('Track down the stale cache');
  await expect(row).toContainText('Comment match ·');
  await expect(row.locator('mark')).toHaveText(phrase);

  await row.click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/documents/${taskId}`));
});
