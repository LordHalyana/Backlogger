import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createProject } from './helpers.js';

const DATA_DIR = process.env.BACKLOGGER_DATA_DIR ?? path.resolve(process.cwd(), '.e2e-data');

/**
 * First Kanban board (spec #13). Each test creates its own Backlogger project
 * so tests stay isolated on the shared e2e data dir.
 */

interface BacklogFile {
  title: string;
  taskState?: string;
  status?: string;
  createdAt?: string;
}

/** Write a backlog item straight to disk, like a legacy or hand-edited file. */
async function writeBacklogItem(
  projectId: string,
  item: BacklogFile,
): Promise<{ id: string; file: string }> {
  const id = randomUUID();
  const created = item.createdAt ?? new Date().toISOString();
  const lines = [
    '---',
    `id: ${id}`,
    `title: ${item.title}`,
    `project: ${projectId}`,
    'type: backlog_item',
    `status: ${item.status ?? 'active'}`,
    ...(item.taskState ? [`task_state: ${item.taskState}`] : []),
    `created_at: '${created}'`,
    `updated_at: '${created}'`,
    'tags: []',
    '---',
    '',
    `# ${item.title}`,
    '',
  ];
  const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const file = path.join(DATA_DIR, 'projects', projectId, 'backlog', `${slug}.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, lines.join('\n'), 'utf8');
  return { id, file };
}

/**
 * Re-sync the selected project from disk via the topbar Reload button and wait
 * until `title` is indexed. The file watcher may already be reindexing, in
 * which case the manual reload reports "in progress" — either way the item
 * shows up in the document tree.
 */
async function reloadUntilIndexed(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.getByRole('complementary').getByText(title, { exact: true })).toBeVisible();
}

async function openBoard(page: Page): Promise<void> {
  await page
    .getByRole('group', { name: 'Project view' })
    .getByRole('button', { name: 'Board' })
    .click();
}

function column(page: Page, label: 'To do' | 'In progress' | 'Done') {
  return page.getByRole('region', { name: label, exact: true });
}

test('board view switch shows a legacy backlog item in To do, and survives a refresh', async ({
  page,
}) => {
  const projectId = `board-switch-${Date.now()}`;
  await page.goto('/');
  await createProject(page, { id: projectId });
  await writeBacklogItem(projectId, { title: 'Legacy item' });
  await reloadUntilIndexed(page, 'Legacy item');

  await openBoard(page);
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/board$`));
  await expect(column(page, 'To do').getByRole('article', { name: 'Legacy item' })).toBeVisible();

  await page.reload();
  await expect(column(page, 'To do').getByRole('article', { name: 'Legacy item' })).toBeVisible();
});

test('dragging a card to In progress persists across a reload', async ({ page }) => {
  const projectId = `board-drag-${Date.now()}`;
  await page.goto('/');
  await createProject(page, { id: projectId });
  const { file } = await writeBacklogItem(projectId, { title: 'Drag me' });
  await reloadUntilIndexed(page, 'Drag me');
  await openBoard(page);

  const card = column(page, 'To do').getByRole('article', { name: 'Drag me' });
  await card.dragTo(column(page, 'In progress'));
  const moved = column(page, 'In progress').getByRole('article', { name: 'Drag me' });
  await expect(moved).toBeVisible();
  await expect(moved.getByText('Saving…')).toHaveCount(0);

  await page.reload();
  await expect(column(page, 'In progress').getByRole('article', { name: 'Drag me' })).toBeVisible();
  expect(await fs.readFile(file, 'utf8')).toContain('status: active\ntask_state: in_progress\n');
});

test('cards in a read-only project are marked and cannot be moved', async ({ page }) => {
  const projectId = `board-ro-${Date.now()}`;
  await page.goto('/');
  await createProject(page, { id: projectId });
  const { file } = await writeBacklogItem(projectId, { title: 'Mounted item' });
  await reloadUntilIndexed(page, 'Mounted item');
  const res = await page.request.put(`/api/projects/${projectId}`, { data: { readOnly: true } });
  expect(res.ok()).toBe(true);
  const before = await fs.readFile(file, 'utf8');

  await page.goto(`/projects/${projectId}/board`);
  const card = column(page, 'To do').getByRole('article', { name: 'Mounted item' });
  await expect(card.getByText('Read-only')).toBeVisible();
  await expect(card).toHaveAttribute('draggable', 'false');

  await card.dragTo(column(page, 'Done'));
  await expect(column(page, 'To do').getByRole('article', { name: 'Mounted item' })).toBeVisible();
  await expect(column(page, 'Done').getByRole('article')).toHaveCount(0);
  expect(await fs.readFile(file, 'utf8')).toBe(before);
});

test('Alt+→ moves a focused card to the next column and persists', async ({ page }) => {
  const projectId = `board-keys-${Date.now()}`;
  await page.goto('/');
  await createProject(page, { id: projectId });
  const { file } = await writeBacklogItem(projectId, { title: 'Keyboard item' });
  await reloadUntilIndexed(page, 'Keyboard item');
  await openBoard(page);

  const card = column(page, 'To do').getByRole('article', { name: 'Keyboard item' });
  await card.focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/board$`));
  await expect(column(page, 'To do').getByRole('article', { name: 'Keyboard item' })).toBeVisible();

  await page.keyboard.press('Alt+ArrowRight');
  const inProgress = column(page, 'In progress').getByRole('article', { name: 'Keyboard item' });
  await expect(inProgress).toBeVisible();
  await expect(inProgress.getByText('Saving…')).toHaveCount(0);
  await expect(inProgress).toBeFocused();

  await page.keyboard.press('Alt+ArrowRight');
  const done = column(page, 'Done').getByRole('article', { name: 'Keyboard item' });
  await expect(done).toBeVisible();
  await expect(done.getByText('Saving…')).toHaveCount(0);
  await page.keyboard.press('Alt+ArrowRight');
  await expect(done).toBeVisible();

  await page.reload();
  await expect(column(page, 'Done').getByRole('article', { name: 'Keyboard item' })).toBeVisible();
  expect(await fs.readFile(file, 'utf8')).toContain('task_state: done\n');
});

test('Enter opens a card in the editor with Back to board, surviving refresh and Back', async ({
  page,
}) => {
  const projectId = `board-open-${Date.now()}`;
  await page.goto('/');
  await createProject(page, { id: projectId });
  const { id } = await writeBacklogItem(projectId, { title: 'Open me' });
  await reloadUntilIndexed(page, 'Open me');
  await openBoard(page);

  await column(page, 'To do').getByRole('article', { name: 'Open me' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/board/documents/${id}$`));
  await expect(page.locator('.workspace-title')).toHaveText('Open me');
  await expect(page.getByRole('button', { name: 'Back to board' })).toBeVisible();

  await page.reload();
  await expect(page.locator('.workspace-title')).toHaveText('Open me');
  await expect(page.getByRole('button', { name: 'Back to board' })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/board$`));
  await expect(column(page, 'To do').getByRole('article', { name: 'Open me' })).toBeVisible();

  await page.goForward();
  await page.getByRole('button', { name: 'Back to board' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/board$`));
  await expect(column(page, 'To do').getByRole('article', { name: 'Open me' })).toBeVisible();
});

test('a document opened from the tree has no Back to board control', async ({ page }) => {
  const projectId = `board-tree-${Date.now()}`;
  await page.goto('/');
  await createProject(page, { id: projectId });
  const { id } = await writeBacklogItem(projectId, { title: 'Tree item' });
  await reloadUntilIndexed(page, 'Tree item');
  // Even while the Board view is showing, a tree pick opens the plain editor.
  await openBoard(page);

  await page.getByRole('complementary').getByText('Tree item', { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/documents/${id}$`));
  await expect(page.locator('.workspace-title')).toHaveText('Tree item');
  await expect(page.getByRole('button', { name: 'Back to board' })).toHaveCount(0);
});

test('archiving a Done card removes it, and Undo restores it to Done', async ({ page }) => {
  const projectId = `board-archive-${Date.now()}`;
  await page.goto('/');
  await createProject(page, { id: projectId });
  const { file } = await writeBacklogItem(projectId, { title: 'Finished item', taskState: 'done' });
  await writeBacklogItem(projectId, { title: 'Open item', taskState: 'todo' });
  await reloadUntilIndexed(page, 'Finished item');
  await openBoard(page);

  // Only Done cards offer Archive.
  await expect(
    column(page, 'To do')
      .getByRole('article', { name: 'Open item' })
      .getByRole('button', { name: 'Archive' }),
  ).toHaveCount(0);

  const card = column(page, 'Done').getByRole('article', { name: 'Finished item' });
  await card.getByRole('button', { name: 'Archive' }).click();
  await expect(column(page, 'Done').getByRole('article', { name: 'Finished item' })).toHaveCount(0);
  const notice = page.getByRole('status').filter({ hasText: 'Archived' });
  await expect(notice).toContainText('Finished item');
  await expect
    .poll(() =>
      fs.access(file).then(
        () => true,
        () => false,
      ),
    )
    .toBe(false);

  await notice.getByRole('button', { name: 'Undo' }).click();
  await expect(column(page, 'Done').getByRole('article', { name: 'Finished item' })).toBeVisible();
  await expect
    .poll(() => fs.readFile(file, 'utf8').catch(() => ''))
    .toContain('status: active\ntask_state: done\n');

  await page.reload();
  await expect(column(page, 'Done').getByRole('article', { name: 'Finished item' })).toBeVisible();
});

test('a move after an out-of-band disk edit snaps back with a conflict banner', async ({
  page,
}) => {
  const projectId = `board-conflict-${Date.now()}`;
  await page.goto('/');
  await createProject(page, { id: projectId });
  const { file } = await writeBacklogItem(projectId, { title: 'Contested item' });
  await reloadUntilIndexed(page, 'Contested item');
  await openBoard(page);
  await expect(
    column(page, 'To do').getByRole('article', { name: 'Contested item' }),
  ).toBeVisible();

  // Someone edits the file on disk; the board is not reloaded.
  const edited = (await fs.readFile(file, 'utf8')).replace(
    '# Contested item',
    '# Contested item\n\nEdited on disk.',
  );
  await fs.writeFile(file, edited, 'utf8');

  await column(page, 'To do')
    .getByRole('article', { name: 'Contested item' })
    .dragTo(column(page, 'In progress'));

  await expect(page.getByRole('alert')).toContainText('not saved');
  await expect(
    column(page, 'To do').getByRole('article', { name: 'Contested item' }),
  ).toBeVisible();
  await expect(column(page, 'In progress').getByRole('article')).toHaveCount(0);
  expect(await fs.readFile(file, 'utf8')).toBe(edited);
});
