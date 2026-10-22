import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Project, RecoveryDetail, RecoverySummary } from '@backlogger/shared';
import { DialogProvider } from '../lib/dialog.js';
import { RecoveryBanner } from './RecoveryBanner.js';
import { RecoveryPage } from './RecoveryPage.js';

/** DOM assertions, in place of jest-dom, which this repo does not use. */
interface DomMatchers<R = unknown> {
  toHaveTextContent(text: string): R;
  toHaveAttribute(name: string, value?: string): R;
  toHaveClass(name: string): R;
}
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface Assertion<T> extends DomMatchers<T> {}
}

expect.extend({
  toHaveTextContent(received: Element, text: string) {
    const actual = received.textContent ?? '';
    return {
      pass: actual.includes(text),
      message: () => `expected "${actual}" ${this.isNot ? 'not ' : ''}to contain "${text}"`,
    };
  },
  toHaveAttribute(received: Element, name: string, value?: string) {
    const actual = received.getAttribute(name);
    return {
      pass: value === undefined ? actual !== null : actual === value,
      message: () =>
        `expected ${name}=${String(actual)} ${this.isNot ? 'not ' : ''}to be ${String(value)}`,
    };
  },
  toHaveClass(received: Element, name: string) {
    return {
      pass: received.classList.contains(name),
      message: () =>
        `expected class "${received.className}" ${this.isNot ? 'not ' : ''}to include ${name}`,
    };
  },
});

const TASK = '7f3c2a10-0000-4000-8000-000000000001';
const COMMENT = '01aa0000-0000-4000-8000-000000000002';
const EDIT_OP = '4b1e0c9a-77d2-4f0e-9a51-3c2d8e6f1a20';
const FILE_OP = '9d0f6b3e-1c84-4a2b-b7e5-52a0f3c9e811';
const DELETE_OP = 'c27a8e41-0b6f-4d39-8e2c-7f15a4d0b962';
const MOVING_OP = '5e93c0d7-2a18-4b6c-a4f0-e1b8d2730c45';

const PROJECTS: Project[] = [
  { id: 'inbox', name: 'Inbox', isInbox: true } as Project,
  { id: 'bl', name: 'Backlogger' } as Project,
];

const CURRENT = 'Export writes CRLF.\n\nChecked with Excel.\nNumbers opens it.\n';
const PENDING = 'Export writes CRLF.\n\nChecked with Excel.\nPython reads it too.\n';

function summary(input: Partial<RecoverySummary> & Pick<RecoverySummary, 'operation_id'>) {
  return {
    command: 'comment.edit',
    state: 'pending',
    created_at: '2026-10-21T09:42:00.000Z',
    kind: 'content_conflict',
    reason: 'content_changed',
    message: 'The comment file was changed outside this operation.',
    project_id: 'bl',
    task_id: TASK,
    task_title: 'CSV line endings',
    target_project_id: null,
    comment_id: COMMENT,
    in_progress: false,
    abandoned_at: null,
    ...input,
  } as RecoverySummary;
}

function detail(s: RecoverySummary, input: Partial<RecoveryDetail> = {}): RecoveryDetail {
  return {
    ...s,
    paths: [],
    actions: ['recheck'],
    review_token: 'token-1',
    pending_content: null,
    current_content: null,
    ...input,
  };
}

const editOp = summary({ operation_id: EDIT_OP });
const fileOp = summary({
  operation_id: FILE_OP,
  command: 'document.file',
  kind: 'structural',
  reason: 'unexpected_file',
  message: 'A different file already exists where filing was copying a comment.',
  project_id: 'inbox',
  target_project_id: 'bl',
  task_id: 'a91d03ee-0000-4000-8000-000000000003',
  task_title: 'Meeting notes',
  comment_id: null,
});
const deleteOp = summary({
  operation_id: DELETE_OP,
  command: 'document.delete',
  kind: 'content_conflict',
  reason: 'content_changed',
  message: 'A file changed after deletion began.',
  task_id: 'e04b77c2-0000-4000-8000-000000000004',
  task_title: 'Spike',
  comment_id: null,
});
const movingOp = summary({
  operation_id: MOVING_OP,
  command: 'document.file',
  kind: 'resumable',
  reason: 'interrupted',
  project_id: 'inbox',
  target_project_id: 'bl',
  task_id: 'b0000000-0000-4000-8000-000000000005',
  task_title: 'NAS backup',
  comment_id: null,
  in_progress: true,
});
const abandonedOp = summary({
  operation_id: 'aaaaaaaa-0000-4000-8000-000000000006',
  state: 'abandoned',
  task_title: 'Old edit',
  abandoned_at: '2026-10-21T10:07:00.000Z',
});

const commentPath = `bl/tickets/${TASK}/comments/${COMMENT}.md`;

function editDetail(current = CURRENT, token = 'token-1'): RecoveryDetail {
  return detail(editOp, {
    actions: ['recheck', 'abandon'],
    review_token: token,
    pending_content: PENDING,
    current_content: current,
    paths: [
      {
        path: commentPath,
        before_revision: 'r-before',
        after_revision: 'r-after',
        observed_revision: 'r-other',
      },
    ],
  });
}

const fileDetail = detail(fileOp, {
  paths: [
    {
      path: 'bl/tickets/a91d03ee.md',
      before_revision: null,
      after_revision: 'r1',
      observed_revision: 'r1',
    },
    {
      path: 'bl/tickets/a91d03ee/comments/x.md',
      before_revision: null,
      after_revision: 'r2',
      observed_revision: 'r-different',
    },
  ],
});

interface Reply {
  status: number;
  body: unknown;
}

interface Server {
  operations: RecoverySummary[];
  details: Map<string, RecoveryDetail>;
  /** Replies for successive POSTs, in order. */
  posts: Reply[];
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function json({ status, body }: Reply): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(server: Server): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init });
      if (init?.method === 'POST') {
        const next = server.posts.shift();
        if (next) return json(next);
      }
      if (url === '/api/recovery')
        return json({ status: 200, body: { operations: server.operations } });
      if (url === '/api/projects') return json({ status: 200, body: PROJECTS });
      const id = /^\/api\/recovery\/([^/]+)$/.exec(url)?.[1];
      const found = id ? server.details.get(id) : undefined;
      if (found) return json({ status: 200, body: found });
      return json({ status: 404, body: { error: { code: 'NOT_FOUND', message: url } } });
    }),
  );
  return calls;
}

function server(input: Partial<Server> = {}): Server {
  return {
    operations: [editOp, fileOp, deleteOp, movingOp],
    details: new Map([
      [EDIT_OP, editDetail()],
      [FILE_OP, fileDetail],
      [DELETE_OP, detail(deleteOp)],
      [MOVING_OP, detail(movingOp, { actions: [] })],
    ]),
    posts: [],
    ...input,
  };
}

function wrap(children: JSX.Element): JSX.Element {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <DialogProvider>{children}</DialogProvider>
    </QueryClientProvider>
  );
}

function Page({ initial, onOpenTask }: { initial: string | null; onOpenTask?: () => void }) {
  const [selected, setSelected] = useState<string | null>(initial);
  return (
    <RecoveryPage
      operationId={selected}
      projects={PROJECTS}
      onSelect={setSelected}
      onOpenTask={onOpenTask ?? vi.fn()}
    />
  );
}

function renderPage(initial: string | null = EDIT_OP, onOpenTask?: () => void): void {
  render(wrap(<Page initial={initial} onOpenTask={onOpenTask} />));
}

function panel(): HTMLElement {
  return screen.getByRole('region', { name: /Review/ });
}

function live(): HTMLElement {
  return screen.getByTestId('recovery-live');
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('RecoveryBanner', () => {
  it('counts the operations that need review, not moves in progress or abandoned ones', async () => {
    mockFetch(server({ operations: [editOp, fileOp, movingOp, abandonedOp] }));
    const onOpen = vi.fn();
    render(wrap(<RecoveryBanner onOpen={onOpen} />));
    const banner = await screen.findByRole('region', { name: 'Recovery' });
    expect(banner).toHaveTextContent(
      '2 items need recovery review. Some writes to them are paused until you review.',
    );
    expect(within(banner).queryByRole('button', { name: /dismiss/i })).toBeNull();
    fireEvent.click(within(banner).getByRole('button', { name: 'Open Recovery' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('says "item needs" for one, and is absent while only moves are in progress', async () => {
    mockFetch(server({ operations: [fileOp] }));
    render(wrap(<RecoveryBanner onOpen={vi.fn()} />));
    expect(await screen.findByRole('region', { name: 'Recovery' })).toHaveTextContent(
      '1 item needs recovery review.',
    );
    cleanup();

    const calls = mockFetch(server({ operations: [movingOp, abandonedOp] }));
    render(wrap(<RecoveryBanner onOpen={vi.fn()} />));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/recovery')).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('region', { name: 'Recovery' })).toBeNull();
  });
});

describe('RecoveryPage', () => {
  it('focuses its heading, counts what needs review and lists every operation', async () => {
    mockFetch(server());
    renderPage(null);
    const heading = screen.getByRole('heading', { name: 'Recovery', level: 2 });
    expect(document.activeElement).toBe(heading);
    expect(await screen.findByText('3 need review · 1 in progress')).toBeTruthy();
    const list = screen.getByRole('listbox', { name: 'Operations' });
    const options = within(list).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('CSV line endings'),
      expect.stringContaining('Meeting notes'),
      expect.stringContaining('Spike'),
      expect.stringContaining('NAS backup'),
    ]);
    expect(options[1]).toHaveTextContent('Inbox → Backlogger');
    expect(options[3]).toHaveTextContent('Moving…');
    expect(screen.getByText('Select an operation.')).toBeTruthy();
  });

  it('↑/↓ move the selection and keep focus in the list', async () => {
    mockFetch(server());
    renderPage(EDIT_OP);
    const list = await screen.findByRole('listbox', { name: 'Operations' });
    const first = await within(list).findByRole('option', { name: /CSV line endings/ });
    expect(first).toHaveAttribute('aria-selected', 'true');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    const second = within(list).getByRole('option', { name: /Meeting notes/ });
    await waitFor(() => expect(second).toHaveAttribute('aria-selected', 'true'));
    expect(document.activeElement).toBe(second);
    expect(
      await within(panel()).findByRole('heading', { name: /Meeting notes: Inbox → Backlogger/ }),
    ).toBeTruthy();
    fireEvent.keyDown(second, { key: 'ArrowUp' });
    await waitFor(() => expect(first).toHaveAttribute('aria-selected', 'true'));
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(first).toHaveAttribute('aria-selected', 'true');
  });

  it.each([
    [EDIT_OP, 'Content conflict', 'Edit comment on CSV line endings'],
    [FILE_OP, 'Filing stopped', 'Meeting notes: Inbox → Backlogger'],
    [DELETE_OP, 'Deletion stopped', 'Delete Spike permanently'],
  ])('labels %s with its kind badge', async (id, badge, heading) => {
    mockFetch(server());
    renderPage(id);
    const p = panel();
    expect(await within(p).findByRole('heading', { name: heading })).toBeTruthy();
    expect(within(p).getByText(badge, { selector: '.recovery-badge' })).toBeTruthy();
  });

  it('a content conflict shows the facts and both versions side by side, changed lines tinted', async () => {
    mockFetch(server());
    renderPage(EDIT_OP, vi.fn());
    const p = panel();
    expect(
      await within(p).findByText('The comment file was changed outside this operation.'),
    ).toBeTruthy();
    expect(within(p).getByText('Attempted').nextElementSibling).toHaveTextContent(
      'Edit a comment on CSV line endings',
    );
    expect(within(p).getByText('File').nextElementSibling).toHaveTextContent(commentPath);
    expect(within(p).getByText('Operation ID').nextElementSibling).toHaveTextContent(EDIT_OP);
    expect(within(p).getByText('Started')).toBeTruthy();

    const current = within(p).getByRole('region', { name: 'Current file' });
    const pending = within(p).getByRole('region', { name: /Pending change/ });
    expect(current).toHaveTextContent('Numbers opens it.');
    expect(pending).toHaveTextContent('Python reads it too.');
    expect(within(current).getByText('Numbers opens it.')).toHaveClass('is-changed');
    expect(within(current).getByText('Checked with Excel.')).not.toHaveClass('is-changed');
    expect(within(pending).getByText('Python reads it too.')).toHaveClass('is-changed');
    expect(within(pending).getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(within(pending).getByRole('link', { name: 'Download .md' })).toHaveAttribute('download');
    expect(within(p).queryByRole('table')).toBeNull();
    expect(within(p).getByRole('button', { name: 'Recheck' })).toHaveClass('btn--primary');
    expect(
      within(p).getByRole('button', { name: 'Keep current file and abandon pending change…' }),
    ).toBeTruthy();
    expect(within(p).getByRole('button', { name: 'Open task' })).toBeTruthy();
  });

  it('a structural problem shows a path table and numbered repair steps ending in Recheck, with no abandon', async () => {
    mockFetch(server());
    renderPage(FILE_OP);
    const p = panel();
    const table = await within(p).findByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['Path', 'Expected', 'Found']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('bl/tickets/a91d03ee.md');
    expect(rows[0]).not.toHaveClass('is-problem');
    expect(rows[1]).toHaveTextContent('bl/tickets/a91d03ee/comments/x.md');
    expect(rows[1]).toHaveClass('is-problem');
    const steps = within(within(p).getByRole('list', { name: 'To repair' })).getAllByRole(
      'listitem',
    );
    expect(steps.at(-1)).toHaveTextContent('Choose Recheck.');
    expect(steps.some((s) => s.textContent?.includes('bl/tickets/a91d03ee/comments/x.md'))).toBe(
      true,
    );
    expect(within(p).getByText(/This operation cannot be abandoned/)).toBeTruthy();
    expect(within(p).queryByRole('button', { name: /abandon/i })).toBeNull();
    expect(within(p).queryByRole('region', { name: 'Current file' })).toBeNull();
  });

  it('a deletion has no Open task: the task is hidden', async () => {
    mockFetch(server());
    renderPage(DELETE_OP);
    const p = panel();
    await within(p).findByRole('heading', { name: 'Delete Spike permanently' });
    expect(within(p).queryByRole('button', { name: 'Open task' })).toBeNull();
  });

  it('a move in progress shows its progress and no actions', async () => {
    mockFetch(
      server({
        details: new Map([
          [
            MOVING_OP,
            detail(movingOp, {
              actions: ['recheck'],
              paths: [1, 2, 3].map((n) => ({
                path: `bl/tickets/t${n}.md`,
                before_revision: null,
                after_revision: `r${n}`,
                observed_revision: n < 3 ? `r${n}` : null,
              })),
            }),
          ],
        ]),
      }),
    );
    renderPage(MOVING_OP);
    const p = panel();
    expect(await within(p).findByText('Copying 2 of 3 files. No action needed.')).toBeTruthy();
    expect(within(p).queryByRole('button', { name: 'Recheck' })).toBeNull();
  });

  it('abandon is confirmed inline in place of the action row, with focus on Keep reviewing', async () => {
    const s = server();
    const calls = mockFetch(s);
    renderPage(EDIT_OP);
    const p = panel();
    const abandonButton = await within(p).findByRole('button', {
      name: 'Keep current file and abandon pending change…',
    });
    fireEvent.click(abandonButton);
    const confirm = within(p).getByRole('group', {
      name: 'Keep the current file and abandon your edit?',
    });
    expect(confirm).toHaveTextContent(
      'Your pending text is discarded. Copy or download it first if you want to keep it. This cannot be undone.',
    );
    expect(within(p).queryByRole('button', { name: 'Recheck' })).toBeNull();
    const keep = within(confirm).getByRole('button', { name: 'Keep reviewing' });
    await waitFor(() => expect(document.activeElement).toBe(keep));

    fireEvent.keyDown(keep, { key: 'Escape' });
    const again = within(p).getByRole('button', {
      name: 'Keep current file and abandon pending change…',
    });
    await waitFor(() => expect(document.activeElement).toBe(again));

    fireEvent.click(again);
    s.posts.push({
      status: 200,
      body: {
        operation_id: 'x',
        command: 'recovery.abandon',
        target_operation_id: EDIT_OP,
        outcome: 'abandoned',
      },
    });
    const abandoned = detail(
      { ...editOp, state: 'abandoned', abandoned_at: '2026-10-21T10:07:00.000Z' },
      { actions: [] },
    );
    s.details.set(EDIT_OP, abandoned);
    s.operations = [{ ...abandoned }, fileOp, deleteOp, movingOp];
    fireEvent.click(within(p).getByRole('button', { name: 'Abandon pending change' }));

    const final = await within(p).findByRole('heading', { name: 'Pending change abandoned' });
    await waitFor(() => expect(document.activeElement).toBe(final.closest('[tabindex]')));
    expect(p).toHaveTextContent('The current file was kept unchanged.');
    expect(p).toHaveTextContent('cannot be recovered from Backlogger');
    expect(p).toHaveTextContent('Comment writes on CSV line endings are available again.');
    expect(p).toHaveTextContent(EDIT_OP.slice(0, 8));
    expect(p).toHaveTextContent('Retrying the original edit returns this result.');
    expect(live()).toHaveTextContent('Pending change abandoned. Current file kept.');
    const post = calls.find((c) => c.url === `/api/recovery/${EDIT_OP}/abandon`);
    expect(new Headers(post?.init?.headers).get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(post?.init?.body))).toEqual({ review_token: 'token-1' });
    const option = screen.getByRole('option', { name: /CSV line endings/ });
    expect(option).toHaveTextContent('Abandoned');
  });

  it('a stale review aborts the abandon with a focused notice and shows the new current file', async () => {
    const s = server();
    mockFetch(s);
    renderPage(EDIT_OP);
    const p = panel();
    fireEvent.click(
      await within(p).findByRole('button', {
        name: 'Keep current file and abandon pending change…',
      }),
    );
    s.posts.push({
      status: 409,
      body: { error: { code: 'REVISION_CONFLICT', message: 'Changed.', details: {} } },
    });
    s.details.set(EDIT_OP, editDetail('Edited somewhere else entirely.\n', 'token-2'));
    fireEvent.click(within(p).getByRole('button', { name: 'Abandon pending change' }));

    const notice = await within(p).findByText(
      'The file changed since you opened this review. Review the new current file, then choose again.',
    );
    await waitFor(() => expect(document.activeElement).toBe(notice.closest('[tabindex]')));
    expect(
      await within(within(p).getByRole('region', { name: 'Current file' })).findByText(
        'Edited somewhere else entirely.',
      ),
    ).toBeTruthy();
    expect(live()).toHaveTextContent(
      'Not abandoned. The file changed since you opened this review.',
    );
    expect(within(p).queryByRole('heading', { name: 'Pending change abandoned' })).toBeNull();
    expect(within(p).getByRole('button', { name: 'Recheck' })).toBeTruthy();
  });

  it('Recheck that finds nothing changed says so; one that finishes shows the result and takes focus', async () => {
    const s = server();
    mockFetch(s);
    renderPage(FILE_OP);
    const p = panel();
    s.posts.push({
      status: 200,
      body: {
        operation_id: FILE_OP,
        state: 'pending',
        acknowledgement: null,
        recovery: fileDetail,
      },
    });
    fireEvent.click(await within(p).findByRole('button', { name: 'Recheck' }));
    expect(await within(p).findByText(/still stopped/i)).toBeTruthy();
    expect(live()).toHaveTextContent('Still stopped. Follow the repair steps.');

    s.posts.push({
      status: 200,
      body: { operation_id: FILE_OP, state: 'completed', acknowledgement: {}, recovery: null },
    });
    s.operations = [editOp, deleteOp, movingOp];
    fireEvent.click(within(p).getByRole('button', { name: 'Recheck' }));
    const done = await within(p).findByText('Filed to Backlogger.');
    await waitFor(() => expect(document.activeElement).toBe(done.closest('[tabindex]')));
    expect(live()).toHaveTextContent('Filed to Backlogger.');
  });
});
