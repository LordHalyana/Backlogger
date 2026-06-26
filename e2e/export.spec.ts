import { test, expect } from '@playwright/test';
import { createProject, createDocument, expectSaved } from './helpers.js';

/**
 * Block 4 (Markdown Export) e2e:
 *   create a project + note → click the toolbar Download → verify the
 *   downloaded file contains the body we wrote and the on-disk frontmatter.
 *
 * The Download button is rendered as an `<a download>`; we intercept the
 * download via Playwright instead of letting the browser save it to disk.
 */
test('toolbar Download streams the raw markdown for the active document', async ({ page }) => {
  const projectId = `export-${Date.now()}`;
  const projectName = `Export ${projectId}`;
  const docTitle = 'Export Doc';
  const bodyToken = ' EXPORT-TOKEN-XYZ';

  await page.goto('/');

  await createProject(page, { id: projectId, name: projectName });

  await createDocument(page, { title: docTitle, type: 'note' });

  // Type something and let it autosave so the on-disk file is current.
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('End');
  await editor.pressSequentially(bodyToken, { delay: 15 });
  await expectSaved(page);

  // Trigger the download and capture it.
  const downloadLink = page.getByRole('link', { name: 'Download' });
  await expect(downloadLink).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadLink.click(),
  ]);

  // Browsers pick the RFC 5987 `filename*` (the human-readable title) over
  // the ASCII fallback (the slugged on-disk filename). Accept either.
  expect(download.suggestedFilename()).toMatch(
    /^(Export Doc\.md|export-doc-[0-9a-f]{8}\.md)$/,
  );

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const content = Buffer.concat(chunks).toString('utf8');

  expect(content).toContain(bodyToken.trim());
  expect(content).toContain('title: Export Doc');
});
