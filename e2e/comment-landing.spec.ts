import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Landing on a comment (#71): from search beyond the newest page, and from a
 * direct link after the task was filed. The e2e data dir is shared across
 * runs, so ids and search words are timestamped.
 */

interface CommentPageBody {
  comments: { id: string }[];
}

async function createProject(request: APIRequestContext, id: string): Promise<void> {
  const res = await request.post('/api/projects', { data: { id, name: id } });
  expect(res.ok(), await res.text()).toBe(true);
}

async function createTask(
  request: APIRequestContext,
  projectId: string,
  title: string,
): Promise<{ id: string; revision: string }> {
  const res = await request.post(`/api/projects/${projectId}/documents`, {
    data: { title, type: 'backlog_item' },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { id: string; revision: string };
}

async function postComment(
  request: APIRequestContext,
  taskId: string,
  body: string,
): Promise<string> {
  const id = randomUUID();
  const res = await request.post(`/api/documents/${taskId}/comments`, {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { id, body },
  });
  expect(res.status(), await res.text()).toBe(201);
  return id;
}

test('search for an old comment beyond the newest 50 lands on it with its neighbours', async ({
  page,
}) => {
  const stamp = Date.now();
  const projectId = `landing-${stamp}`;
  const word = `quasarfinch${stamp}`;
  await createProject(page.request, projectId);
  const task = await createTask(page.request, projectId, 'Long-running investigation');
  const ids: string[] = [];
  for (let i = 0; i < 60; i += 1) {
    const body = i === 4 ? `Tried the ${word} workaround; it held.` : `Progress note ${i}`;
    ids.push(await postComment(page.request, task.id, body));
  }
  const target = ids[4]!;
  const around = (await (
    await page.request.get(`/api/documents/${task.id}/comments?around=${target}`)
  ).json()) as CommentPageBody;
  expect(around.comments).toHaveLength(5);

  await page.goto(`/projects/${projectId}`);
  await page.locator('.search-button').click();
  const palette = page.getByRole('dialog', { name: 'Search documents' });
  await palette.getByRole('searchbox').fill(word);
  const row = palette.getByRole('option').filter({ hasText: 'Long-running investigation' });
  await expect(row.getByText(/^Comment match · /)).toBeVisible();
  await row.click();

  await expect(page).toHaveURL(
    new RegExp(`/projects/${projectId}/documents/${task.id}/comments/${target}$`),
  );
  const landed = page.locator(`[data-testid="comment"][data-comment-id="${target}"]`);
  await expect(landed).toBeFocused();
  await expect(landed.getByText('From search')).toBeVisible();
  await expect(landed.locator('mark')).toHaveText(word);
  await expect(page.getByRole('tab', { name: 'Comments (60)' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('region', { name: 'Comment reader' })).toHaveCount(0);

  const shown = page.getByTestId('comment');
  await expect(shown).toHaveCount(5);
  expect(
    await shown.evaluateAll((els) => els.map((el) => el.getAttribute('data-comment-id'))),
  ).toEqual(around.comments.map((c) => c.id));
  await expect(page.getByRole('button', { name: 'Load older comments' })).toBeVisible();
  await expect(page.getByText('2 earlier')).toBeVisible();
  await expect(page.getByText('53 newer comments')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show newer comments' })).toBeVisible();

  await page.getByRole('button', { name: 'Jump to latest' }).click();
  await expect(shown).toHaveCount(50);
  await expect(page.getByText('Progress note 59')).toBeVisible();
});

test('a comment link still lands on the comment after the task was filed', async ({ page }) => {
  const stamp = Date.now();
  const from = `landing-from-${stamp}`;
  const to = `landing-to-${stamp}`;
  await createProject(page.request, from);
  await createProject(page.request, to);
  const task = await createTask(page.request, from, 'Task that moves');
  await postComment(page.request, task.id, 'Before the move');
  const target = await postComment(page.request, task.id, 'The comment the link points at');
  await postComment(page.request, task.id, 'After it');
  const link = `/projects/${from}/documents/${task.id}/comments/${target}`;

  const filed = await page.request.post(`/api/documents/${task.id}/file`, {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { target_project_id: to, revision: task.revision },
  });
  expect(filed.ok(), await filed.text()).toBe(true);

  await page.goto(link);
  await expect(page).toHaveURL(
    new RegExp(`/projects/${to}/documents/${task.id}/comments/${target}$`),
  );
  const landed = page.locator(`[data-testid="comment"][data-comment-id="${target}"]`);
  await expect(landed).toBeFocused();
  await expect(landed.getByText('From search')).toBeVisible();
  await expect(landed.getByText('The comment the link points at')).toBeVisible();
});
