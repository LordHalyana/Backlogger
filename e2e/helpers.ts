import { expect, type Page } from '@playwright/test';

/**
 * Shared e2e flows. These reproduce the exact Playwright interactions the specs
 * previously inlined, so behaviour is unchanged — they only remove copy-paste.
 *
 * Callers still drive navigation (`page.goto('/')`) themselves; these helpers
 * only cover the repeated dialog/save steps.
 */

export interface CreateProjectOptions {
  id: string;
  /** Display name. Defaults to `id` (several specs reuse the id as the name). */
  name?: string;
}

/** Create a project through the topbar "+ New Project" dialog and select it. */
export async function createProject(
  page: Page,
  opts: CreateProjectOptions,
): Promise<void> {
  await page.getByRole('button', { name: '+ New Project' }).click();
  await page.getByLabel('ID').fill(opts.id);
  await page.getByLabel('Name', { exact: true }).fill(opts.name ?? opts.id);
  await page.getByRole('button', { name: 'Create' }).click();
}

export interface CreateDocumentOptions {
  title: string;
  /** Selected in the Type dropdown when provided (otherwise the default). */
  type?: string;
  /** Selected in the Template dropdown when provided. */
  template?: string;
}

/**
 * Create a document through the "+ New" document dialog. Does not wait for
 * autosave — call `expectSaved` afterwards when the test needs a flushed file.
 */
export async function createDocument(
  page: Page,
  opts: CreateDocumentOptions,
): Promise<void> {
  await page.getByRole('button', { name: '+ New', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Document' });
  if (opts.type) await dialog.getByLabel('Type').selectOption(opts.type);
  if (opts.template) await dialog.getByLabel('Template').selectOption(opts.template);
  await dialog.getByLabel('Title').fill(opts.title);
  await page.getByRole('button', { name: 'Create' }).click();
}

/** Wait for the editor autosave indicator to read "Saved". */
export async function expectSaved(page: Page): Promise<void> {
  await expect(page.locator('.status-label')).toHaveText('Saved', { timeout: 5000 });
}
