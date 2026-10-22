import { test, expect } from '@playwright/test';
import { createProject } from './helpers.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * User-defined templates (Block 4):
 *
 *   write a custom template file to .e2e-data/templates/ →
 *   open Settings → click Reload →
 *   open New Document dialog → assert template appears.
 */
test('user template appears in new-document dialog after reload', async ({ page }) => {
  const templateId = `e2e-custom-tmpl-${Date.now()}`;
  const templateName = `E2E Custom Template ${Date.now()}`;
  const projectId = `user-tmpl-${Date.now()}`;

  // Write the template file into the e2e data dir.
  const templateContent = [
    '---',
    `template_id: ${templateId}`,
    `template_name: ${templateName}`,
    'type: note',
    '---',
    '# {{title}}',
    '',
    'Created by e2e user-template test.',
  ].join('\n');

  // BACKLOGGER_DATA_DIR is set to an absolute path by playwright.config.ts.
  const dataDir =
    process.env.BACKLOGGER_DATA_DIR ?? path.resolve(process.cwd(), '.e2e-data');
  const templatesDir = path.join(dataDir, 'templates');
  const templateFile = path.join(templatesDir, `${templateId}.md`);
  await fs.mkdir(templatesDir, { recursive: true });
  await fs.writeFile(templateFile, templateContent);

  try {
    await page.goto('/');

    // Create a project so the New button is available.
    await createProject(page, { id: projectId });

    // Open Settings and trigger a template reload.
    await page.getByRole('button', { name: 'Settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings).toBeVisible();

    const reloadBtn = settings.getByRole('button', { name: /Reload/i });
    await reloadBtn.click();

    // Wait for reload to complete: the toast "Templates reloaded" appears.
    await expect(page.getByText(/Templates reloaded/)).toBeVisible({ timeout: 10000 });

    // Close settings.
    await page.getByRole('button', { name: 'Close' }).click();

    // Open New Document dialog.
    await page.getByRole('button', { name: '+ New', exact: true }).click();

    // The template should appear in the Template dropdown.
    const newDocDialog = page.getByRole('dialog', { name: 'New Document' });
    await newDocDialog.getByLabel('Type').selectOption('note');
    const templateSelect = newDocDialog.getByLabel('Template');
    await expect(templateSelect.locator(`option[value="${templateId}"]`)).toHaveCount(1, {
      timeout: 5000,
    });
  } finally {
    // Clean up the template file so it doesn't leak into other specs.
    await fs.rm(templateFile, { force: true });
  }
});

test('settings dialog lists templates with source badges', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();

  // Reload templates to ensure the table reflects the current filesystem
  // (the previous spec may have left a now-deleted user template in the
  // server-side cache). Scoped to the dialog: the workspace rail also lists
  // other specs' "Reload …" projects.
  await settings.getByRole('button', { name: /Reload/i }).click();
  await expect(page.getByText(/Templates reloaded/)).toBeVisible({ timeout: 10000 });

  // The template table should show exactly the six built-in templates.
  const rows = page.locator('.settings-template-table tbody tr');
  await expect(rows).toHaveCount(6, { timeout: 3000 });

  // All visible badges should say "built-in".
  const badges = page.locator('.template-source-badge');
  for (const badge of await badges.all()) {
    await expect(badge).toContainText('built-in');
  }
});
