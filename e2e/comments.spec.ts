import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const DATA_DIR = process.env.BACKLOGGER_DATA_DIR ?? path.resolve(process.cwd(), '.e2e-data');

/**
 * Comments tab (#69): add a large comment, edit it, delete one. The e2e data
 * dir is shared across runs, so the project id is timestamped.
 */

async function createTask(page: Page): Promise<{ projectId: string; taskId: string }> {
  const projectId = `comments-${Date.now()}`;
  const project = await page.request.post('/api/projects', {
    data: { id: projectId, name: projectId },
  });
  expect(project.ok(), await project.text()).toBe(true);
  const doc = await page.request.post(`/api/projects/${projectId}/documents`, {
    data: { title: 'Investigate the slow sync', type: 'backlog_item' },
  });
  expect(doc.ok()).toBe(true);
  const { id } = (await doc.json()) as { id: string };
  return { projectId, taskId: id };
}

async function commentFiles(projectId: string, taskId: string): Promise<string[]> {
  const dir = path.join(DATA_DIR, 'projects', projectId, 'tickets', taskId, 'comments');
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

const LARGE_COMMENT = [
  '## Findings',
  '',
  'Sync stalls whenever the index is rebuilt during a save.',
  '',
  ...Array.from({ length: 40 }, (_, i) => `- Step ${i + 1}: checked the queue, still waiting.`),
  '',
  '```ts',
  'await coordinator.run(op);',
  '```',
].join('\n');

test('add a large comment, edit it, delete one', async ({ page }) => {
  const { projectId, taskId } = await createTask(page);
  await page.goto(`/projects/${projectId}/documents/${taskId}`);

  const commentsTab = page.getByRole('tab', { name: 'Comments (0)' });
  await commentsTab.click();
  await expect(page.getByText('No comments yet.')).toBeVisible();

  // Add a large comment and a short one.
  const composer = page.getByRole('textbox', { name: 'New comment' });
  await composer.fill(LARGE_COMMENT);
  await expect(page.getByRole('tab', { name: 'Comments (0) •' })).toBeVisible();
  await composer.press('Control+Enter');
  await expect(page.getByTestId('comments-live')).toHaveText('Comment posted.');
  await expect(page.getByRole('tab', { name: 'Comments (1)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Findings' })).toBeVisible();
  await expect(page.getByText('Step 40: checked the queue, still waiting.')).toBeVisible();

  await composer.fill('Disposable note');
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(page.getByRole('tab', { name: 'Comments (2)' })).toBeVisible();
  expect(await commentFiles(projectId, taskId)).toHaveLength(2);

  // Edit the large comment in the reader.
  await page.getByTestId('comment').first().click();
  const reader = page.getByRole('region', { name: 'Comment reader' });
  await reader.getByRole('button', { name: 'Edit' }).click();
  const editor = reader.getByRole('textbox', { name: 'Edit comment' });
  await expect(editor).toBeFocused();
  await editor.press('Control+End');
  await editor.pressSequentially('\n\nRoot cause: the rebuild holds the queue.');
  await editor.press('Control+Enter');
  await expect(page.getByTestId('comments-live')).toHaveText('Comment saved.');
  await expect(reader.getByText('Root cause: the rebuild holds the queue.')).toBeVisible();
  await expect(reader.getByText('edited', { exact: true })).toBeVisible();

  // Esc closes the reader; the thread shows the edited marker too.
  await page.keyboard.press('Escape');
  await expect(reader).toBeHidden();
  await expect(
    page.getByTestId('comment').first().getByText('edited', { exact: true }),
  ).toBeVisible();

  // Delete the disposable comment, with confirmation.
  await page.getByTestId('comment').nth(1).click();
  await reader.getByRole('button', { name: 'Delete' }).click();
  await expect(reader.getByText('Delete this comment? This cannot be undone.')).toBeVisible();
  await expect(reader.getByRole('button', { name: 'Keep' })).toBeFocused();
  await reader.getByRole('button', { name: 'Delete comment' }).click();
  await expect(page.getByTestId('comments-live')).toHaveText('Comment deleted. 1 comment.');
  await expect(page.getByRole('tab', { name: 'Comments (1)' })).toBeVisible();
  await expect(page.getByText('Disposable note')).toHaveCount(0);

  const files = await commentFiles(projectId, taskId);
  expect(files).toHaveLength(1);
  const bytes = await fs.readFile(
    path.join(DATA_DIR, 'projects', projectId, 'tickets', taskId, 'comments', files[0]!),
    'utf8',
  );
  expect(bytes).toContain('Root cause: the rebuild holds the queue.');
  expect(bytes).toContain('- Step 40: checked the queue, still waiting.');
});
