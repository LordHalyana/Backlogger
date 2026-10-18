import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createProject } from './helpers.js';

const DATA_DIR = process.env.BACKLOGGER_DATA_DIR ?? path.resolve(process.cwd(), '.e2e-data');

/**
 * Daily-work milestone (spec #40): capture, ⌂ Inbox triage and Current work.
 * The e2e data dir is shared across runs, so each test empties the Inbox
 * first (archiving, never deleting) and uses timestamped names.
 */

interface Card {
  id: string;
  title: string;
  revision: string;
}

interface ProjectBody {
  id: string;
  isInbox: boolean;
}

async function inboxId(page: Page): Promise<string> {
  const res = await page.request.get('/api/projects');
  const inbox = ((await res.json()) as ProjectBody[]).find((p) => p.isInbox);
  expect(inbox, 'the server creates an Inbox at start').toBeTruthy();
  return inbox!.id;
}

async function inboxCards(page: Page): Promise<Card[]> {
  const res = await page.request.get(`/api/projects/${await inboxId(page)}/board`);
  const board = (await res.json()) as { columns: Record<string, Card[]> };
  return Object.values(board.columns).flat();
}

/** Archive whatever earlier runs left in the Inbox, so triage starts clear. */
async function emptyInbox(page: Page): Promise<void> {
  for (const card of await inboxCards(page)) {
    await page.request.put(`/api/documents/${card.id}`, {
      headers: { 'If-Match': card.revision },
      data: { status: 'archived' },
    });
  }
}

/** Only the local app may be reached: the journey must work offline. */
async function blockOutsideNetwork(page: Page): Promise<string[]> {
  const blocked: string[] = [];
  await page.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === '127.0.0.1' || host === 'localhost') return route.continue();
    blocked.push(route.request().url());
    return route.abort();
  });
  return blocked;
}

async function openCapture(page: Page): Promise<void> {
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('n');
  await expect(page.getByRole('dialog', { name: 'Capture' })).toBeVisible();
}

test('S11: capture → ⌂ triage → state change → Current work → search, offline', async ({
  page,
}) => {
  const blocked = await blockOutsideNetwork(page);
  const stamp = Date.now();
  const projectId = `work-${stamp}`;
  const projectName = `Work ${stamp}`;
  const first = `Fix the gate ${stamp}`;
  const second = `Paint the shed ${stamp}`;

  await page.goto('/');
  await emptyInbox(page);
  await createProject(page, { id: projectId, name: projectName });
  await expect(page.locator('#project-select')).toHaveValue(projectId);

  // Capture two tasks from the n palette; it stays open between them.
  await openCapture(page);
  const palette = page.getByRole('dialog', { name: 'Capture' });
  await expect(palette.getByLabel('Destination')).toHaveValue('');
  await palette.getByLabel('Task title').fill(first);
  await palette.getByLabel('Task title').press('Enter');
  await expect(palette.getByText(`Added “${first}” to`)).toBeVisible();
  await expect(palette.getByLabel('Task title')).toHaveValue('');
  await expect(palette.getByLabel('Task title')).toBeFocused();
  await page.keyboard.type(second);
  await page.keyboard.press('Enter');
  await expect(palette.getByText(`Added “${second}” to`)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();

  // ⌂ triage: oldest first. File the first by typing the project's name.
  const rail = page.getByRole('navigation', { name: 'Workspace' });
  await expect(rail.getByLabel('2 in Inbox')).toBeVisible();
  await rail.getByRole('button', { name: /Inbox/ }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByRole('heading', { name: first })).toBeVisible();
  await page.keyboard.type('Work');
  await expect(page.getByLabel('Find a project to file into')).toHaveValue('Work');
  await page.keyboard.type(` ${stamp}`);
  await page.keyboard.press('Enter');
  await expect(page.getByText(`Filed “${first}” in ${projectName}.`)).toBeVisible();

  // The second: start it in place, then file it with 1 (most recently used).
  await expect(page.getByRole('heading', { name: second })).toBeVisible();
  await page.getByLabel(`Task state of “${second}”`).selectOption('in_progress');
  await expect(page.getByLabel(`Task state of “${second}”`)).toHaveValue('in_progress');
  await expect(page.getByRole('article', { name: second })).not.toHaveAttribute(
    'aria-busy',
    'true',
  );
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('1');
  await expect(page.getByText(`Filed “${second}” in ${projectName}.`)).toBeVisible();
  await expect(page.getByText('Inbox is clear.')).toBeVisible();

  // Current work shows it under the project; finishing it there removes it.
  const drawer = page.getByRole('complementary', { name: 'Current work' });
  if (!(await drawer.isVisible())) await page.getByRole('button', { name: 'Current work' }).click();
  const group = drawer.getByRole('region', { name: projectName });
  await expect(group.getByRole('button', { name: second })).toBeVisible();
  await group.getByLabel(`Task state of “${second}”`).selectOption('done');
  await expect(group).toBeHidden();

  // The board agrees, and the file kept its id and moved into the project.
  await rail.getByRole('button', { name: projectName }).click();
  await expect(
    page.locator('[data-state="done"]').getByRole('article', { name: second }),
  ).toBeVisible();
  await expect(
    page.locator('[data-state="todo"]').getByRole('article', { name: first }),
  ).toBeVisible();
  const files = await fs.readdir(path.join(DATA_DIR, 'projects', projectId, 'backlog'));
  expect(files).toHaveLength(2);

  // Retrieval through the existing search palette.
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search documents…').fill(`gate ${stamp}`);
  await expect(page.getByRole('option', { name: new RegExp(first) })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.workspace-title')).toHaveText(first);

  expect(blocked).toEqual([]);
});

test('S4: a capture whose reply is lost keeps the text; Retry reuses the id and creates one item', async ({
  page,
}) => {
  const title = `Call the plumber ${Date.now()}`;
  await page.goto('/');
  await emptyInbox(page);

  // The first attempt reaches the server, but its reply never arrives.
  const sentIds: string[] = [];
  let loseReply = true;
  await page.route('**/api/capture', async (route) => {
    sentIds.push((route.request().postDataJSON() as { id: string }).id);
    if (loseReply) {
      loseReply = false;
      await route.fetch();
      await route.abort();
    } else {
      await route.continue();
    }
  });

  await openCapture(page);
  const palette = page.getByRole('dialog', { name: 'Capture' });
  await palette.getByLabel('Task title').fill(title);
  await palette.getByLabel('Task title').press('Enter');
  await expect(palette.getByRole('alert')).toContainText('Could not reach the server.');
  await expect(palette.getByLabel('Task title')).toHaveValue(title);
  await expect(palette.getByLabel('Destination')).toHaveValue('');

  await palette.getByRole('button', { name: 'Retry' }).click();
  await expect(palette.getByText(`Added “${title}” to`)).toBeVisible();
  expect(sentIds).toHaveLength(2);
  expect(sentIds[1]).toBe(sentIds[0]);
  expect((await inboxCards(page)).filter((c) => c.title === title)).toHaveLength(1);
});

test('S9: Current work lists read-only items without actions', async ({ page }) => {
  const stamp = Date.now();
  const projectId = `frozen-${stamp}`;
  const title = `Frozen work ${stamp}`;
  await page.goto('/');
  await createProject(page, { id: projectId, name: `Frozen ${stamp}` });

  const id = randomUUID();
  const now = new Date().toISOString();
  const file = path.join(DATA_DIR, 'projects', projectId, 'backlog', `frozen-${stamp}.md`);
  await fs.writeFile(
    file,
    [
      '---',
      `id: ${id}`,
      `title: ${title}`,
      `project: ${projectId}`,
      'type: backlog_item',
      'status: active',
      'task_state: in_progress',
      `created_at: '${now}'`,
      `updated_at: '${now}'`,
      'tags: []',
      '---',
      '',
    ].join('\n'),
  );
  await page.request.post(`/api/projects/${projectId}/reload`);
  await page.request.put(`/api/projects/${projectId}`, { data: { readOnly: true } });

  const drawer = page.getByRole('complementary', { name: 'Current work' });
  if (!(await drawer.isVisible())) await page.getByRole('button', { name: 'Current work' }).click();
  await drawer.getByRole('button', { name: 'Reload Current work' }).click();
  const group = drawer.getByRole('region', { name: `Frozen ${stamp}` });
  await expect(group.getByRole('button', { name: title })).toBeVisible();
  await expect(group.getByText('read-only')).toBeVisible();
  await expect(group.getByRole('combobox')).toHaveCount(0);
});
