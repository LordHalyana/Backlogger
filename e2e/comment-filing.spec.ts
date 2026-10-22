import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

const DATA_DIR = process.env.BACKLOGGER_DATA_DIR ?? path.resolve(process.cwd(), '.e2e-data');

/**
 * Filing carries comments (#72): file a commented task from ⌂ Inbox triage,
 * then archive and restore it; its comments arrive complete and stay in
 * place. The e2e data dir is shared across runs, so the Inbox is emptied
 * first (archiving, never deleting) and names are timestamped.
 */

interface Card {
  id: string;
  revision: string;
}

async function inboxId(page: Page): Promise<string> {
  const res = await page.request.get('/api/projects');
  const inbox = ((await res.json()) as Array<{ id: string; isInbox: boolean }>).find(
    (p) => p.isInbox,
  );
  expect(inbox, 'the server creates an Inbox at start').toBeTruthy();
  return inbox!.id;
}

async function emptyInbox(page: Page, inbox: string): Promise<void> {
  const res = await page.request.get(`/api/projects/${inbox}/board`);
  const board = (await res.json()) as { columns: Record<string, Card[]> };
  for (const card of Object.values(board.columns).flat()) {
    await page.request.put(`/api/documents/${card.id}`, {
      headers: { 'If-Match': card.revision },
      data: { status: 'archived' },
    });
  }
}

/** Every comment file of a task in one project, name → bytes. */
async function commentFiles(projectId: string, taskId: string): Promise<Record<string, string>> {
  const dir = path.join(DATA_DIR, 'projects', projectId, 'tickets', taskId, 'comments');
  const out: Record<string, string> = {};
  for (const name of await fs.readdir(dir).catch(() => [])) {
    out[name] = await fs.readFile(path.join(dir, name), 'utf8');
  }
  return out;
}

test('file a commented task, then archive and restore it, comments intact', async ({ page }) => {
  const stamp = Date.now();
  const projectId = `filing-${stamp}`;
  const projectName = `Filing ${stamp}`;
  const title = `Commented task ${stamp}`;
  const inbox = await inboxId(page);
  await emptyInbox(page, inbox);
  const project = await page.request.post('/api/projects', {
    data: { id: projectId, name: projectName },
  });
  expect(project.ok(), await project.text()).toBe(true);
  const doc = await page.request.post(`/api/projects/${inbox}/documents`, {
    data: { title, type: 'backlog_item' },
  });
  expect(doc.ok(), await doc.text()).toBe(true);
  const taskId = ((await doc.json()) as { id: string }).id;
  for (const body of ['Found the hinge is loose.', '## Decision\n\n- replace it\n- keep the frame']) {
    const res = await page.request.post(`/api/documents/${taskId}/comments`, {
      headers: { 'Idempotency-Key': randomUUID() },
      data: { id: randomUUID(), body },
    });
    expect(res.status(), await res.text()).toBe(201);
  }
  const before = await commentFiles(inbox, taskId);
  expect(Object.keys(before)).toHaveLength(2);

  // ⌂ triage: file it by typing the project's name.
  await page.goto('/inbox');
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.type(projectName);
  await expect(page.getByLabel('Find a project to file into')).toHaveValue(projectName);
  await page.keyboard.press('Enter');
  await expect(page.getByText(`Filed “${title}” in ${projectName}.`)).toBeVisible();
  await expect(page.getByText('Inbox is clear.')).toBeVisible();

  // Every comment arrived byte for byte; none is left behind.
  expect(await commentFiles(projectId, taskId)).toEqual(before);
  expect(await commentFiles(inbox, taskId)).toEqual({});

  await page.goto(`/projects/${projectId}/documents/${taskId}`);
  await page.getByRole('tab', { name: 'Comments (2)' }).click();
  await expect(page.getByText('Found the hinge is loose.')).toBeVisible();

  // Archive, then restore from the Comments tab: the files never move.
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  const restore = page.getByRole('button', { name: 'Restore task' });
  await expect(restore).toBeVisible();
  expect(await commentFiles(projectId, taskId)).toEqual(before);
  await restore.click();
  await expect(restore).toBeHidden();
  await expect(page.getByRole('tab', { name: 'Comments (2)' })).toBeVisible();
  await expect(page.getByText('Found the hinge is loose.')).toBeVisible();
  expect(await commentFiles(projectId, taskId)).toEqual(before);
});
