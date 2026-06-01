import { test, expect } from '@playwright/test';

/**
 * Tag explorer (Block 3):
 *
 *   create project → create a doc and add tag "e2e-tag" via MetadataPanel →
 *   autosave → click the tag in the TagExplorer sidebar →
 *   assert filter bar appears and doc is still listed.
 */
test('clicking a tag in the explorer filters the document tree', async ({ page }) => {
  const projectId = `tags-${Date.now()}`;
  const docTitle = `Tagged Doc ${Date.now()}`;
  const tag = 'e2e-filter-tag';

  await page.goto('/');

  // Create project.
  await page.getByRole('button', { name: '+ New Project' }).click();
  await page.getByLabel('ID').fill(projectId);
  await page.getByLabel('Name', { exact: true }).fill(projectId);
  await page.getByRole('button', { name: 'Create' }).click();

  // Create doc.
  await page.getByRole('button', { name: '+ New', exact: true }).click();
  await page.getByRole('dialog', { name: 'New Document' }).getByLabel('Title').fill(docTitle);
  await page.getByRole('button', { name: 'Create' }).click();

  // Add a tag via the MetadataPanel tag input.
  const tagInput = page.locator('.tag-input');
  await tagInput.fill(tag);
  await tagInput.press('Enter');

  // Wait for autosave.
  await expect(page.locator('.status-label')).toHaveText('Saved', { timeout: 5000 });

  // The TagExplorer (in the sidebar) should now show the tag.
  const tagExplorer = page.locator('.tag-explorer');
  await expect(tagExplorer).toBeVisible();
  const tagChip = tagExplorer.locator('.tag-chip', { hasText: tag });
  await expect(tagChip).toBeVisible({ timeout: 8000 });

  // Click the tag to activate filter.
  await tagChip.click();

  // The filter bar should appear with an active tag chip.
  const filterBar = page.locator('.tag-filter-bar');
  await expect(filterBar).toBeVisible();
  await expect(filterBar).toContainText(tag);

  // The filtered document list should still contain our doc.
  await expect(page.getByText(docTitle)).toBeVisible();
});

test('clearing the tag filter restores the full document list', async ({ page }) => {
  const projectId = `tags-clear-${Date.now()}`;
  const docA = `Doc A ${Date.now()}`;
  const docB = `Doc B ${Date.now()}`;
  const tag = 'clear-test-tag';

  await page.goto('/');

  await page.getByRole('button', { name: '+ New Project' }).click();
  await page.getByLabel('ID').fill(projectId);
  await page.getByLabel('Name', { exact: true }).fill(projectId);
  await page.getByRole('button', { name: 'Create' }).click();

  // Create doc A with a tag.
  await page.getByRole('button', { name: '+ New', exact: true }).click();
  await page.getByRole('dialog', { name: 'New Document' }).getByLabel('Title').fill(docA);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.locator('.tag-input').fill(tag);
  await page.locator('.tag-input').press('Enter');
  // Confirm the tag was captured (status goes Unsaved) before waiting for save.
  await expect(page.locator('.status-label')).toHaveText('Unsaved changes', { timeout: 3000 });
  await expect(page.locator('.status-label')).toHaveText('Saved', { timeout: 5000 });

  // Create doc B without any tags.
  await page.getByRole('button', { name: '+ New', exact: true }).click();
  await page.getByRole('dialog', { name: 'New Document' }).getByLabel('Title').fill(docB);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.status-label')).toHaveText('Saved', { timeout: 5000 });

  // Filter by tag — doc B should disappear.
  const tagChip = page.locator('.tag-explorer').locator('.tag-chip', { hasText: tag });
  await expect(tagChip).toBeVisible({ timeout: 8000 });
  await tagChip.click();
  await expect(page.getByText(docB)).not.toBeVisible();

  // Clear filter — doc B reappears.
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.locator('.tag-filter-bar')).not.toBeVisible();
  await expect(page.getByText(docB)).toBeVisible();
});
