import { test, expect } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

const DATA_DIR = process.env.BACKLOGGER_DATA_DIR ?? path.resolve(process.cwd(), '.e2e-data');

/**
 * The browser recovery journey (#74, spec #58): a comment edit is left
 * pending by a failed write, then changed on disk, so it needs review. The
 * user hits the block while a draft is open, keeps the draft, reviews the
 * conflict, abandons the pending change and posts the kept draft.
 *
 * The write fails because the comment folder is made read-only, which a root
 * user ignores. The e2e data dir is shared across runs, so names are timestamped.
 */
test('hit a recovery block with a draft open, keep it, review and abandon, then post', async ({
  page,
}) => {
  test.skip(process.getuid?.() === 0, 'root ignores the read-only folder that fails the write');
  const stamp = Date.now();
  const projectId = `recovery-${stamp}`;
  const title = `Recovering task ${stamp}`;
  expect(
    (
      await page.request.post('/api/projects', {
        data: { id: projectId, name: `Recovery ${stamp}` },
      })
    ).ok(),
  ).toBe(true);
  const doc = await page.request.post(`/api/projects/${projectId}/documents`, {
    data: { title, type: 'backlog_item' },
  });
  expect(doc.ok(), await doc.text()).toBe(true);
  const { id: taskId } = (await doc.json()) as { id: string };
  const commentId = randomUUID();
  const posted = await page.request.post(`/api/documents/${taskId}/comments`, {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { id: commentId, body: 'Original finding.' },
  });
  expect(posted.status(), await posted.text()).toBe(201);

  await page.goto(`/projects/${projectId}/documents/${taskId}`);
  await page.getByRole('tab', { name: /Comments/ }).click();
  const composer = page.getByRole('textbox', { name: 'New comment' });
  await composer.fill('My draft that must survive.');

  // An edit whose write fails stays pending; then the file changes on disk.
  const commentDir = path.join(DATA_DIR, 'projects', projectId, 'tickets', taskId, 'comments');
  const commentFile = path.join(commentDir, `${commentId}.md`);
  const { revision } = (await (await page.request.get(`/api/comments/${commentId}`)).json()) as {
    revision: string;
  };
  const editKey = randomUUID();
  await fs.chmod(commentDir, 0o555);
  try {
    const failed = await page.request.put(`/api/comments/${commentId}`, {
      headers: { 'Idempotency-Key': editKey, 'If-Match': revision },
      data: { body: 'My pending edit.' },
    });
    expect(failed.status()).toBe(500);
  } finally {
    await fs.chmod(commentDir, 0o755);
  }
  await fs.appendFile(commentFile, '\nEdited outside Backlogger.\n');

  // The block: posting is refused, the draft stays and the composer pauses.
  await page.getByRole('button', { name: 'Post comment' }).click();
  const notice = page.getByRole('note', { name: 'Recovery' });
  await expect(notice).toContainText('A comment change needs your review.');
  await expect(composer).toBeDisabled();
  await expect(composer).toHaveValue('My draft that must survive.');
  await expect(
    page.getByText('Writing is paused while recovery is pending. Your draft is kept.'),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recovery' })).toContainText(
    /item(s)? need(s)? recovery review/,
  );

  // Review: no leave prompt, since the draft is kept.
  await notice.getByRole('button', { name: 'Review recovery' }).click();
  await expect(page).toHaveURL(new RegExp(`/recovery/${editKey}$`));
  const panel = page.getByRole('region', { name: 'Review' });
  await expect(panel.getByText('Content conflict', { exact: true })).toBeVisible();
  await expect(panel.getByRole('region', { name: 'Current file' })).toContainText(
    'Edited outside Backlogger.',
  );
  await expect(panel.getByRole('region', { name: /Pending change/ })).toContainText(
    'My pending edit.',
  );

  // Recheck changes nothing; abandon keeps the current file.
  await panel.getByRole('button', { name: 'Recheck' }).click();
  await expect(panel).toContainText('still different from both known versions');
  await panel
    .getByRole('button', { name: 'Keep current file and abandon pending change…' })
    .click();
  await expect(panel.getByRole('button', { name: 'Keep reviewing' })).toBeFocused();
  await panel.getByRole('button', { name: 'Abandon pending change' }).click();
  await expect(panel.getByRole('heading', { name: 'Pending change abandoned' })).toBeVisible();
  expect(await fs.readFile(commentFile, 'utf8')).toContain('Edited outside Backlogger.');

  // Back on the task: the draft is restored and can be posted.
  await panel.getByRole('button', { name: 'Open task' }).click();
  await expect(page.getByRole('note', { name: 'Recovery' })).toContainText(
    'Pending change abandoned. The current file was kept.',
  );
  await page.getByRole('tab', { name: /Comments/ }).click();
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue('My draft that must survive.');
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(
    page.getByTestId('comment').filter({ hasText: 'My draft that must survive.' }),
  ).toBeVisible();
  await page
    .getByRole('note', { name: 'Recovery' })
    .getByRole('button', { name: 'Dismiss' })
    .click();
  await expect(page.getByRole('note', { name: 'Recovery' })).toHaveCount(0);
});
