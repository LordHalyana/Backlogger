import { test, expect } from '@playwright/test';

/**
 * Document linking & backlinks (Block 2):
 *
 *   create project → create doc B → create doc A with [[Doc B]] in body →
 *   autosave → open doc B → assert backlinks panel shows doc A.
 */
test('wiki-link creates backlink on target document', async ({ page }) => {
  const projectId = `links-${Date.now()}`;
  const titleB = `Links-B-${Date.now()}`;
  const titleA = `Links-A-${Date.now()}`;

  await page.goto('/');

  // Create project.
  await page.getByRole('button', { name: '+ New Project' }).click();
  await page.getByLabel('ID').fill(projectId);
  await page.getByLabel('Name', { exact: true }).fill(projectId);
  await page.getByRole('button', { name: 'Create' }).click();

  // Create doc B (the link target).
  await page.getByRole('button', { name: '+ New', exact: true }).click();
  await page.getByRole('dialog', { name: 'New Document' }).getByLabel('Title').fill(titleB);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.status-label')).toHaveText('Saved', { timeout: 5000 });

  // Create doc A and type a wiki-link pointing to doc B.
  await page.getByRole('button', { name: '+ New', exact: true }).click();
  await page.getByRole('dialog', { name: 'New Document' }).getByLabel('Title').fill(titleA);
  await page.getByRole('button', { name: 'Create' }).click();

  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('End');
  await editor.pressSequentially(` [[${titleB}]]`, { delay: 20 });

  // Confirm the edit was captured before waiting for autosave.
  await expect(page.locator('.status-label')).toHaveText('Unsaved changes', { timeout: 3000 });
  await expect(page.locator('.status-label')).toHaveText('Saved', { timeout: 5000 });

  // Navigate to doc B by clicking it in the project tree.
  await page.locator('button.tree-item').filter({ hasText: titleB }).click();

  // The backlinks panel (inside MetadataPanel) should list doc A.
  const backlinksSection = page.locator('.backlinks');
  await expect(backlinksSection).toBeVisible();
  await expect(backlinksSection).toContainText(titleA, { timeout: 8000 });
});
