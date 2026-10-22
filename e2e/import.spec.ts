import { test, expect } from '@playwright/test';
import { createProject } from './helpers.js';

/**
 * Block 3 (Markdown Import) e2e:
 *   create a project → open Import dialog → set chooser files via the file
 *   input → submit → verify the new document shows in the tree.
 */
test('topbar Import ingests a .md file via the file picker', async ({ page }) => {
  const projectId = `import-${Date.now()}`;
  const projectName = `Import ${projectId}`;

  await page.goto('/');

  await createProject(page, { id: projectId, name: projectName });

  // Open the import dialog.
  // exact: the workspace rail also lists other specs' "Import …" projects.
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import Markdown' });
  await expect(dialog).toBeVisible();

  // Stage an in-memory .md file.
  const fileContent = '# Imported Heading\n\nbody from import e2e\n';
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'imported-note.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(fileContent, 'utf8'),
  });
  await expect(dialog.getByTestId('import-staged-files')).toContainText('imported-note.md');

  // Default placement is { type: note, titleStrategy: frontmatter, onDuplicate: skip }.
  // Switch to H1 so the title is derived from the heading.
  await dialog.getByLabel('Title strategy').selectOption('h1');

  await dialog.getByRole('button', { name: 'Import' }).click();

  const result = dialog.getByTestId('import-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('Imported: 1');

  // The modal has a header × and a footer button, both named Close.
  await dialog.getByRole('button', { name: 'Close' }).first().click();

  // The imported doc should appear in the project tree under Notes.
  await expect(
    page.getByRole('button', { name: 'Imported Heading', exact: true }),
  ).toBeVisible();
});
