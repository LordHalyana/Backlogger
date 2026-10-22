import { test, expect } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

const DATA_DIR = process.env.BACKLOGGER_DATA_DIR ?? path.resolve(process.cwd(), '.e2e-data');

/**
 * Permanent deletion with comments (#73): the delete dialog says the comments
 * go too, and confirming removes the task file, its comment folder and the
 * card. The e2e data dir is shared across runs, so names are timestamped.
 */
test('deleting a commented task warns about its comments and removes them all', async ({
  page,
}) => {
  const stamp = Date.now();
  const projectId = `deleting-${stamp}`;
  const title = `Doomed task ${stamp}`;
  const project = await page.request.post('/api/projects', {
    data: { id: projectId, name: `Deleting ${stamp}` },
  });
  expect(project.ok(), await project.text()).toBe(true);
  const doc = await page.request.post(`/api/projects/${projectId}/documents`, {
    data: { title, type: 'backlog_item' },
  });
  expect(doc.ok(), await doc.text()).toBe(true);
  const { id: taskId, path: taskPath } = (await doc.json()) as { id: string; path: string };
  const res = await page.request.post(`/api/documents/${taskId}/comments`, {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { id: randomUUID(), body: 'A finding that goes with the task.' },
  });
  expect(res.status(), await res.text()).toBe(201);
  const ticketDir = path.join(DATA_DIR, 'projects', projectId, 'tickets', taskId);
  await expect(fs.access(ticketDir)).resolves.toBeUndefined();

  await page.goto(`/projects/${projectId}/documents/${taskId}`);
  await page.getByRole('button', { name: /Delete document/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`Delete "${title}" and all of its comments?`);
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(dialog).toBeHidden();

  await expect.poll(() => fs.access(ticketDir).then(() => true, () => false)).toBe(false);
  await expect(fs.access(path.join(DATA_DIR, 'projects', taskPath))).rejects.toThrow();
  expect((await page.request.get(`/api/documents/${taskId}`)).status()).toBe(404);
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByText(title)).toHaveCount(0);
});
