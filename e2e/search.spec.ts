import { test, expect } from '@playwright/test';

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
  await page.getByRole('button', { name: '+ New Project' }).click();
  await page.getByLabel('ID').fill(projectId);
  await page.getByLabel('Name', { exact: true }).fill(projectId);
  await page.getByRole('button', { name: 'Create' }).click();

  // Create a "noise" doc (should not appear in results).
  await page.getByRole('button', { name: '+ New', exact: true }).click();
  await page.getByRole('dialog', { name: 'New Document' }).getByLabel('Title').fill('Noise Doc One');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.status-label')).toHaveText('Saved', { timeout: 5000 });

  // Create the target doc containing the unique phrase.
  await page.getByRole('button', { name: '+ New', exact: true }).click();
  await page.getByRole('dialog', { name: 'New Document' }).getByLabel('Title').fill('Target Document');
  await page.getByRole('button', { name: 'Create' }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('End');
  await editor.pressSequentially(' ' + uniquePhrase, { delay: 20 });
  // Confirm the edit was captured before waiting for autosave.
  await expect(page.locator('.status-label')).toHaveText('Unsaved changes', { timeout: 3000 });
  await expect(page.locator('.status-label')).toHaveText('Saved', { timeout: 5000 });

  // Create another noise doc.
  await page.getByRole('button', { name: '+ New', exact: true }).click();
  await page.getByRole('dialog', { name: 'New Document' }).getByLabel('Title').fill('Noise Doc Two');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.status-label')).toHaveText('Saved', { timeout: 5000 });

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
