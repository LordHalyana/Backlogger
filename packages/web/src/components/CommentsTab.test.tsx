import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Comment, CommentAck, CommentPage, Document } from '@backlogger/shared';
import { DocumentWorkspace } from './DocumentWorkspace.js';
import { DialogProvider } from '../lib/dialog.js';
import { useConfirmLeave } from '../lib/leave-guard.js';

const TASK_ID = '11111111-2222-3333-4444-555555555555';

const task: Document = {
  id: TASK_ID,
  project_id: 'aa',
  title: 'Fix the parser',
  type: 'backlog_item',
  status: 'active',
  path: 'aa/backlog/fix-the-parser-11111111.md',
  tags: [],
  readOnly: false,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  revision: 'task-rev-1',
  body: 'The parser drops trailing spaces.\n',
};

function commentId(n: number): string {
  return `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function makeComment(n: number, body = `Comment number ${n}`): Comment {
  const at = new Date(Date.UTC(2026, 9, 2, 0, n)).toISOString();
  return {
    id: commentId(n),
    parent_id: TASK_ID,
    project_id: 'aa',
    body,
    created_at: at,
    updated_at: at,
    revision: `rev-${n}-1`,
    writable: true,
  };
}

interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = { status: number; payload: unknown } | 'hold';

/**
 * An in-memory comment API: GET/POST task comments, GET/PUT/DELETE a comment.
 * `override(method, reply)` answers the next matching mutation instead.
 */
function fakeServer(doc: Document, initial: Comment[] = []) {
  let comments = [...initial];
  const requests: Recorded[] = [];
  const overrides: { method: string; reply: Reply }[] = [];
  const held: ((r: Response) => void)[] = [];
  let seq = 0;

  const json = (status: number, payload: unknown): Response =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
    requests.push({ method, url, headers, body });

    if (method !== 'GET') {
      const i = overrides.findIndex((o) => o.method === method);
      if (i >= 0) {
        const { reply } = overrides.splice(i, 1)[0]!;
        if (reply === 'hold') return new Promise<Response>((resolve) => held.push(resolve));
        return json(reply.status, reply.payload);
      }
    }

    const [path, query = ''] = url.split('?');
    if (path === `/api/documents/${doc.id}` && method === 'GET') return json(200, doc);
    if (path === `/api/documents/${doc.id}` && method === 'PUT') {
      return json(200, { ...doc, ...(body as object), revision: 'task-rev-2' });
    }
    if (path === `/api/documents/${doc.id}/comments` && method === 'GET') {
      const cursor = new URLSearchParams(query).get('cursor');
      const end = cursor === null ? comments.length : Number(cursor);
      const start = Math.max(0, end - 50);
      const page: CommentPage = {
        comments: comments.slice(start, end),
        next_cursor: start > 0 ? String(start) : null,
        total: comments.length,
      };
      return json(200, page);
    }
    if (path === `/api/documents/${doc.id}/comments` && method === 'POST') {
      const input = body as { id: string; body: string };
      const at = new Date(Date.UTC(2026, 9, 20, 0, ++seq)).toISOString();
      comments.push({
        id: input.id,
        parent_id: doc.id,
        project_id: 'aa',
        body: input.body,
        created_at: at,
        updated_at: at,
        revision: `rev-new-${seq}`,
        writable: true,
      });
      const ack: CommentAck = {
        operation_id: headers['Idempotency-Key']!,
        command: 'comment.create',
        comment_id: input.id,
        parent_id: doc.id,
        outcome: 'created',
        result_revision: `rev-new-${seq}`,
      };
      return json(201, ack);
    }
    const m = /^\/api\/comments\/([^/]+)$/.exec(path!);
    const current = m ? comments.find((c) => c.id === m[1]) : undefined;
    if (m && !current) {
      return json(404, { error: { code: 'COMMENT_NOT_FOUND', message: 'gone' } });
    }
    if (current && method === 'GET') return json(200, current);
    if (current && (method === 'PUT' || method === 'DELETE')) {
      if (headers['If-Match'] !== current.revision) {
        return json(409, {
          error: {
            code: 'REVISION_CONFLICT',
            message: 'stale',
            details: { current_revision: current.revision },
          },
        });
      }
      if (method === 'DELETE') {
        comments = comments.filter((c) => c.id !== current.id);
      } else {
        const next = {
          ...current,
          body: (body as { body: string }).body,
          updated_at: '2026-10-21T00:00:00.000Z',
          revision: `${current.revision}+`,
        };
        comments = comments.map((c) => (c.id === current.id ? next : c));
      }
      return json(200, {
        operation_id: headers['Idempotency-Key'],
        command: method === 'DELETE' ? 'comment.delete' : 'comment.edit',
        comment_id: current.id,
        parent_id: doc.id,
        outcome: method === 'DELETE' ? 'deleted' : 'edited',
        result_revision: method === 'DELETE' ? null : `${current.revision}+`,
      });
    }
    return json(404, { error: { code: 'NOT_FOUND', message: url } });
  });
  vi.stubGlobal('fetch', fetchMock);

  return {
    requests,
    mutations: (method: string) => requests.filter((r) => r.method === method),
    override: (method: string, reply: Reply) => overrides.push({ method, reply }),
    release: (status: number, payload: unknown) => held.shift()?.(json(status, payload)),
    /** Change a comment behind the UI's back, as another tab would. */
    editBehindTheScenes: (id: string, nextBody: string) => {
      comments = comments.map((c) =>
        c.id === id
          ? {
              ...c,
              body: nextBody,
              revision: `${c.revision}*`,
              updated_at: '2026-10-21T01:00:00.000Z',
            }
          : c,
      );
    },
  };
}

function LeaveButton(): JSX.Element {
  const confirmLeave = useConfirmLeave();
  return (
    <>
      <button type="button" onClick={() => confirmLeave(() => leave())}>
        Go elsewhere
      </button>
      <button
        type="button"
        onClick={() => {
          confirmLeave(() => leave('project'));
          confirmLeave(() => leave('view'));
        }}
      >
        Go in two steps
      </button>
    </>
  );
}

const leave = vi.fn();

function renderTask(doc: Document = task): void {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <DialogProvider>
        <LeaveButton />
        <DocumentWorkspace projectId="aa" documentId={doc.id} theme="dark" onDeleted={vi.fn()} />
      </DialogProvider>
    </QueryClientProvider>,
  );
}

async function openComments(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('tab', { name: /^Comments/ }));
}

function composer(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: 'New comment' }) as HTMLTextAreaElement;
}

function liveRegion(): HTMLElement {
  return screen.getByTestId('comments-live');
}

afterEach(() => {
  vi.unstubAllGlobals();
  leave.mockReset();
  cleanup();
});

describe('Comments tab: tabs', () => {
  it('shows no Comments tab on documents that are not backlog items', async () => {
    fakeServer({ ...task, type: 'note' });
    renderTask({ ...task, type: 'note' });
    await screen.findByDisplayValue('Fix the parser');
    expect(screen.queryByRole('tab', { name: /Comments/ })).toBeNull();
    expect(screen.getByRole('group', { name: 'View mode' })).toBeTruthy();
  });

  it('gives backlog items Description and Comments (total) tabs; view modes belong to Description', async () => {
    fakeServer(task, [makeComment(1), makeComment(2)]);
    const user = userEvent.setup();
    renderTask();
    const commentsTab = await screen.findByRole('tab', { name: 'Comments (2)' });
    const descriptionTab = screen.getByRole('tab', { name: 'Description' });
    expect(descriptionTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('group', { name: 'View mode' })).toBeTruthy();

    await user.click(commentsTab);
    expect(commentsTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('group', { name: 'View mode' })).toBeNull();
    // Title, status and metadata stay visible on both tabs.
    expect(screen.getByDisplayValue('Fix the parser')).toBeTruthy();
    expect(screen.getByText('Comment number 1')).toBeTruthy();

    // Arrow keys move between tabs.
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Description' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Description' }));
  });
});

describe('Comments tab: states', () => {
  it('shows the empty state with the composer still docked', async () => {
    fakeServer(task);
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    expect(await screen.findByText('No comments yet.')).toBeTruthy();
    expect(composer()).toBeTruthy();
  });

  it('marks the tab with • while a draft is unsaved and keeps it across a tab switch', async () => {
    fakeServer(task);
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await user.type(composer(), 'Half a thought');
    expect(screen.getByRole('tab', { name: 'Comments (0) •' })).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Description' }));
    await user.click(screen.getByRole('tab', { name: 'Comments (0) •' }));
    expect(composer().value).toBe('Half a thought');
  });

  it('posts, then focuses the new comment and announces it', async () => {
    const server = fakeServer(task, [makeComment(1)]);
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await screen.findByText('Comment number 1');
    await user.type(composer(), 'Found the cause');
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(liveRegion().textContent).toBe('Comment posted.'));
    const [post] = server.mutations('POST');
    const sent = post!.body as { id: string; body: string };
    expect(sent.body).toBe('Found the cause');
    expect(post!.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent.id).not.toBe(post!.headers['Idempotency-Key']);

    await waitFor(() => expect(document.activeElement?.textContent).toContain('Found the cause'));
    expect(composer().value).toBe('');
    expect(screen.getByRole('tab', { name: 'Comments (2)' })).toBeTruthy();
  });

  it('makes the text read-only while saving and ignores a second submit', async () => {
    const server = fakeServer(task);
    server.override('POST', 'hold');
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await user.type(composer(), 'Once only');
    await user.keyboard('{Control>}{Enter}{/Control}');

    const button = await screen.findByRole('button', { name: 'Posting…' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(composer().readOnly).toBe(true);
    expect(liveRegion().textContent).toBe('Posting comment…');
    composer().focus();
    await user.keyboard('{Control>}{Enter}{/Control}');
    await user.click(button);
    expect(server.mutations('POST')).toHaveLength(1);
  });

  it('keeps the draft on failure and Retry reuses the same Idempotency-Key and comment ID', async () => {
    const server = fakeServer(task);
    server.override('POST', {
      status: 500,
      payload: { error: { code: 'INTERNAL', message: 'disk full' } },
    });
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await user.type(composer(), 'Keep me');
    await user.click(screen.getByRole('button', { name: 'Post comment' }));

    await screen.findByText(/disk full/);
    expect(liveRegion().textContent).toBe('Comment not saved. Your text is kept.');
    expect(composer().value).toBe('Keep me');
    expect(composer().readOnly).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(liveRegion().textContent).toBe('Comment posted.'));
    const [first, second] = server.mutations('POST');
    expect(second!.headers['Idempotency-Key']).toBe(first!.headers['Idempotency-Key']);
    expect((second!.body as { id: string }).id).toBe((first!.body as { id: string }).id);
  });

  it('uses a fresh key once the failed text is changed', async () => {
    const server = fakeServer(task);
    server.override('POST', {
      status: 500,
      payload: { error: { code: 'INTERNAL', message: 'disk full' } },
    });
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await user.type(composer(), 'Keep me');
    await user.click(screen.getByRole('button', { name: 'Post comment' }));
    await screen.findByText(/disk full/);

    await user.type(composer(), '!');
    await user.click(screen.getByRole('button', { name: 'Post comment' }));
    await waitFor(() => expect(liveRegion().textContent).toBe('Comment posted.'));
    const [first, second] = server.mutations('POST');
    expect(second!.headers['Idempotency-Key']).not.toBe(first!.headers['Idempotency-Key']);
  });

  it('keeps the draft and offers Reload task when the task changed while posting', async () => {
    const server = fakeServer(task);
    server.override('POST', {
      status: 409,
      payload: { error: { code: 'REVISION_CONFLICT', message: 'The task was filed elsewhere.' } },
    });
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await user.type(composer(), 'Still mine');
    await user.click(screen.getByRole('button', { name: 'Post comment' }));

    const reload = await screen.findByRole('button', { name: 'Reload task' });
    expect(screen.getByText(/filed elsewhere/)).toBeTruthy();
    expect(composer().value).toBe('Still mine');
    const before = server.requests.filter((r) => r.method === 'GET').length;
    await user.click(reload);
    await waitFor(() =>
      expect(server.requests.filter((r) => r.method === 'GET').length).toBeGreaterThan(before),
    );
    expect(composer().value).toBe('Still mine');
  });

  it('archived: readable, no composer or edit controls, offers Restore task', async () => {
    const server = fakeServer({ ...task, status: 'archived' }, [
      { ...makeComment(1), writable: false },
    ]);
    const user = userEvent.setup();
    renderTask({ ...task, status: 'archived' });
    await openComments(user);
    await user.click(await screen.findByText('Comment number 1'));

    expect(screen.queryByRole('textbox', { name: 'New comment' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add comment' })).toBeNull();
    expect(screen.getByText(/archived/i, { selector: '.comments-notice *' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Restore task' }));
    await waitFor(
      () => {
        const put = server.requests.find(
          (r) => r.method === 'PUT' && r.url === `/api/documents/${TASK_ID}`,
        );
        expect((put?.body as { status?: string } | undefined)?.status).toBe('active');
      },
      { timeout: 3000 },
    );
  });

  it('read-only project: readable, no composer, no Restore task', async () => {
    fakeServer({ ...task, readOnly: true }, [{ ...makeComment(1), writable: false }]);
    const user = userEvent.setup();
    renderTask({ ...task, readOnly: true });
    await openComments(user);
    await user.click(await screen.findByText('Comment number 1'));

    expect(screen.queryByRole('textbox', { name: 'New comment' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restore task' })).toBeNull();
    expect(screen.getByText(/read-only/i, { selector: '.comments-notice *' })).toBeTruthy();
  });
});

describe('Comments tab: history', () => {
  it('opens on the newest 50, oldest to newest, and loads older on request', async () => {
    const all = Array.from({ length: 60 }, (_, i) => makeComment(i + 1));
    fakeServer(task, all);
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await screen.findByText('Comment number 60');
    expect(screen.queryByText('Comment number 10')).toBeNull();
    const shown = screen.getAllByTestId('comment').map((el) => el.dataset.commentId);
    expect(shown[0]).toBe(commentId(11));
    expect(shown.at(-1)).toBe(commentId(60));

    await user.click(screen.getByRole('button', { name: 'Load older comments' }));
    await waitFor(() => expect(liveRegion().textContent).toBe('Showing 60 of 60'));
    expect(screen.queryByRole('button', { name: 'Load older comments' })).toBeNull();
    expect((document.activeElement as HTMLElement).dataset.commentId).toBe(commentId(1));
  });

  it('shows an edited indicator', async () => {
    fakeServer(task, [
      { ...makeComment(1), updated_at: '2026-10-05T00:00:00.000Z' },
      makeComment(2),
    ]);
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await screen.findByText('Comment number 1');
    const [first, second] = screen.getAllByTestId('comment');
    expect(within(first!).getByText('edited')).toBeTruthy();
    expect(within(second!).queryByText('edited')).toBeNull();
  });
});

describe('Comments tab: reader', () => {
  it('opens a comment in the reader, narrows the thread, and Esc returns focus', async () => {
    fakeServer(task, [makeComment(1), makeComment(2, 'Second\nwith more lines')]);
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await user.click(await screen.findByText('Comment number 1'));

    const reader = screen.getByRole('region', { name: 'Comment reader' });
    expect(within(reader).getByText('Comment number 1')).toBeTruthy();
    expect(screen.getByTestId('comments-thread').classList.contains('is-narrow')).toBe(true);

    // ↓ in the rows changes the reader.
    const rows = screen.getAllByTestId('comment');
    rows[0]!.focus();
    await user.keyboard('{ArrowDown}');
    expect(within(reader).getByText(/with more lines/)).toBeTruthy();
    expect(document.activeElement).toBe(rows[1]);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Comment reader' })).toBeNull();
    expect((document.activeElement as HTMLElement).dataset.commentId).toBe(commentId(2));
  });

  it('edits in the reader: Ctrl+Enter saves with If-Match, focuses the saved comment and shows edited', async () => {
    const server = fakeServer(task, [makeComment(1)]);
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await user.click(await screen.findByText('Comment number 1'));
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const editor = screen.getByRole('textbox', { name: 'Edit comment' });
    expect(document.activeElement).toBe(editor);
    expect(screen.getByRole('tab', { name: 'Comments (1)' })).toBeTruthy();
    await user.type(editor, ' (revised)');
    expect(screen.getByRole('tab', { name: 'Comments (1) •' })).toBeTruthy();
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    await waitFor(() => expect(liveRegion().textContent).toBe('Comment saved.'));
    const [put] = server.mutations('PUT');
    expect(put!.url).toBe(`/api/comments/${commentId(1)}`);
    expect(put!.headers['If-Match']).toBe('rev-1-1');
    expect(put!.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(put!.body).toEqual({ body: 'Comment number 1 (revised)' });

    const reader = screen.getByRole('region', { name: 'Comment reader' });
    await waitFor(() =>
      expect(within(reader).getByText('Comment number 1 (revised)')).toBeTruthy(),
    );
    expect(document.activeElement).toBe(within(reader).getByTestId('reader-comment'));
    expect(within(reader).getByText('edited')).toBeTruthy();
  });

  it('cancelling an edit returns focus to Edit; Esc cancels the edit before closing the reader', async () => {
    fakeServer(task, [makeComment(1), makeComment(2)]);
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await user.click(await screen.findByText('Comment number 1'));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Edit comment' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('region', { name: 'Comment reader' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit' }));
  });

  it('disables Edit and Delete on other comments while one edit is open', async () => {
    fakeServer(task, [makeComment(1), makeComment(2)]);
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await user.click(await screen.findByText('Comment number 1'));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getAllByTestId('comment')[1]!);
    const reader = screen.getByRole('region', { name: 'Comment reader' });
    expect(within(reader).getByText('Comment number 2')).toBeTruthy();
    expect(
      (within(reader).getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (within(reader).getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows an edit conflict stacked and can continue editing on the current version', async () => {
    const server = fakeServer(task, [makeComment(1)]);
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await user.click(await screen.findByText('Comment number 1'));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByRole('textbox', { name: 'Edit comment' }), ' mine');
    server.editBehindTheScenes(commentId(1), 'Theirs');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const reader = screen.getByRole('region', { name: 'Comment reader' });
    await within(reader).findByText('Theirs');
    expect(within(reader).getByText('Comment number 1 mine')).toBeTruthy();
    expect(liveRegion().textContent).toMatch(/changed/i);

    await user.click(screen.getByRole('button', { name: 'Continue editing on current version' }));
    const editor = screen.getByRole('textbox', { name: 'Edit comment' }) as HTMLTextAreaElement;
    expect(editor.value).toBe('Comment number 1 mine');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(liveRegion().textContent).toBe('Comment saved.'));
    const puts = server.mutations('PUT');
    expect(puts.at(-1)!.headers['If-Match']).toBe('rev-1-1*');
  });

  it('discarding a conflicting edit keeps the current version', async () => {
    const server = fakeServer(task, [makeComment(1)]);
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await user.click(await screen.findByText('Comment number 1'));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByRole('textbox', { name: 'Edit comment' }), ' mine');
    server.editBehindTheScenes(commentId(1), 'Theirs');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await user.click(await screen.findByRole('button', { name: 'Discard my edit' }));

    expect(screen.queryByText('Comment number 1 mine')).toBeNull();
    await waitFor(() => expect(screen.getAllByText('Theirs').length).toBeGreaterThan(0));
    expect(screen.getByRole('tab', { name: 'Comments (1)' })).toBeTruthy();
  });

  it('confirms delete inline with focus on Keep, then shows the next comment and announces the count', async () => {
    const server = fakeServer(task, [makeComment(1), makeComment(2), makeComment(3)]);
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await user.click(await screen.findByText('Comment number 2'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(screen.getByText('Delete this comment? This cannot be undone.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep' }));
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(server.mutations('DELETE')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete comment' }));
    await waitFor(() => expect(liveRegion().textContent).toBe('Comment deleted. 2 comments.'));
    const [del] = server.mutations('DELETE');
    expect(del!.headers['If-Match']).toBe('rev-2-1');
    expect(del!.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);

    const reader = screen.getByRole('region', { name: 'Comment reader' });
    await within(reader).findByText('Comment number 3');
    expect(document.activeElement).toBe(within(reader).getByTestId('reader-comment'));
    expect(screen.queryByText('Comment number 2')).toBeNull();
  });

  it('after deleting the last comment, focus goes to Add comment', async () => {
    fakeServer(task, [makeComment(1)]);
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await user.click(await screen.findByText('Comment number 1'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete comment' }));
    await waitFor(() => expect(liveRegion().textContent).toBe('Comment deleted. 0 comments.'));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add comment' })),
    );
  });
});

describe('Comments tab: composer keyboard and leaving', () => {
  it('Add comment focuses the composer; Esc on an empty composer returns to Add comment', async () => {
    fakeServer(task);
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await user.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(document.activeElement).toBe(composer());
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add comment' }));
  });

  it('asks Stay / Discard and leave when leaving with a draft', async () => {
    fakeServer(task);
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await user.type(composer(), 'Unfinished');

    await user.click(screen.getByRole('button', { name: 'Go elsewhere' }));
    await user.click(await screen.findByRole('button', { name: 'Stay' }));
    expect(leave).not.toHaveBeenCalled();
    expect(composer().value).toBe('Unfinished');

    await user.click(screen.getByRole('button', { name: 'Go elsewhere' }));
    await user.click(await screen.findByRole('button', { name: 'Discard and leave' }));
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('asks once when one action navigates in several steps', async () => {
    fakeServer(task);
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await user.type(composer(), 'Unfinished');

    await user.click(screen.getByRole('button', { name: 'Go in two steps' }));
    expect(screen.getAllByRole('button', { name: 'Stay' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Discard and leave' }));
    expect(leave.mock.calls).toEqual([['project'], ['view']]);
  });

  it('leaves without asking when there is no draft', async () => {
    fakeServer(task);
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await user.click(screen.getByRole('button', { name: 'Go elsewhere' }));
    expect(leave).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Stay' })).toBeNull();
  });

  it('a held post cannot be lost by the composer: act flushes cleanly', async () => {
    const server = fakeServer(task);
    server.override('POST', 'hold');
    const user = userEvent.setup();
    renderTask();
    await openComments(user);
    await user.type(composer(), 'Slow');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await screen.findByRole('button', { name: 'Posting…' });
    await act(async () => {
      server.release(500, { error: { code: 'INTERNAL', message: 'late failure' } });
    });
    await screen.findByText(/late failure/);
    expect(composer().value).toBe('Slow');
  });
});
