import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  Board,
  BoardCard,
  CommentPage,
  CurrentWork,
  Document,
  Project,
  RecoverySummary,
} from '@backlogger/shared';
import { DialogProvider } from '../lib/dialog.js';
import { CurrentWorkDrawer } from './CurrentWorkDrawer.js';
import { DocumentWorkspace } from './DocumentWorkspace.js';
import { TaskBoard } from './TaskBoard.js';

/**
 * How pending operations show where the user works (spec #58, #61): board
 * cards, the stopped-deletion notice, Current work rows and the task, with
 * its paused composer and blocked-command toast.
 */

const BLOCKED = '10000000-0000-4000-8000-000000000001';
const MOVING = '10000000-0000-4000-8000-000000000002';
const HIDDEN = '10000000-0000-4000-8000-000000000003';
const PLAIN = '10000000-0000-4000-8000-000000000004';
const EDIT_OP = '20000000-0000-4000-8000-000000000001';
const FILE_OP = '20000000-0000-4000-8000-000000000002';
const DELETE_OP = '20000000-0000-4000-8000-000000000003';

const PROJECTS: Project[] = [
  { id: 'inbox', name: 'Inbox', isInbox: true, readOnly: false } as Project,
  { id: 'bl', name: 'Backlogger', readOnly: false } as Project,
];

function card(id: string, title: string, input: Partial<BoardCard> = {}): BoardCard {
  return {
    id,
    title,
    tags: [],
    status: 'active',
    readOnly: false,
    revision: `rev-${id}`,
    task_state: 'in_progress',
    created_at: '2026-10-01T00:00:00.000Z',
    ...input,
  };
}

function op(input: Partial<RecoverySummary> & Pick<RecoverySummary, 'operation_id'>) {
  return {
    command: 'comment.edit',
    state: 'pending',
    created_at: '2026-10-21T09:42:00.000Z',
    kind: 'content_conflict',
    reason: 'content_changed',
    message: 'Changed.',
    project_id: 'inbox',
    task_id: BLOCKED,
    task_title: 'Blocked task',
    target_project_id: null,
    comment_id: null,
    in_progress: false,
    abandoned_at: null,
    ...input,
  } as RecoverySummary;
}

const editOp = op({ operation_id: EDIT_OP });
const fileOp = op({
  operation_id: FILE_OP,
  command: 'document.file',
  kind: 'resumable',
  task_id: MOVING,
  task_title: 'Moving task',
  target_project_id: 'bl',
  in_progress: true,
});
const deleteOp = op({
  operation_id: DELETE_OP,
  command: 'document.delete',
  task_id: HIDDEN,
  task_title: 'Hidden task',
});

const board: Board = {
  columns: {
    todo: [card(PLAIN, 'Plain task', { task_state: 'todo' })],
    in_progress: [card(BLOCKED, 'Blocked task'), card(MOVING, 'Moving task')],
    done: [],
  },
};

const task: Document = {
  id: BLOCKED,
  project_id: 'inbox',
  title: 'Blocked task',
  type: 'backlog_item',
  status: 'active',
  task_state: 'in_progress',
  path: `inbox/tickets/${BLOCKED}.md`,
  tags: [],
  readOnly: false,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  revision: 'rev-task',
  body: 'Body\n',
} as Document;

const emptyPage: CommentPage = {
  comments: [],
  next_cursor: null,
  newer_cursor: null,
  older_count: 0,
  newer_count: 0,
  total: 0,
};

interface Server {
  operations: RecoverySummary[];
  /** Replies for comment posts and document deletes, in order. */
  writes: Array<{ status: number; body: unknown }>;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const recoveryRequired = (operationId: string) => ({
  status: 409,
  body: {
    error: {
      code: 'RECOVERY_REQUIRED',
      message: 'Blocked.',
      details: { operationId, inspect: `/recovery/${operationId}` },
    },
  },
});

function mockFetch(server: Server): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (init?.method === 'POST' || init?.method === 'DELETE') {
        const next = server.writes.shift();
        if (next) return json(next.status, next.body);
      }
      if (url === '/api/recovery') return json(200, { operations: server.operations });
      if (url === '/api/projects') return json(200, PROJECTS);
      if (url === '/api/projects/inbox/board') return json(200, board);
      if (url === '/api/current-work') {
        const work: CurrentWork = {
          groups: [
            {
              project: { id: 'inbox', name: 'Inbox', readOnly: false, isInbox: true },
              items: [card(BLOCKED, 'Blocked task'), card(PLAIN, 'Plain task')],
            },
          ],
        };
        return json(200, work);
      }
      if (url === `/api/documents/${BLOCKED}`) return json(200, task);
      if (url.startsWith(`/api/documents/${BLOCKED}/comments`)) return json(200, emptyPage);
      if (url.startsWith('/api/recovery/') && url.endsWith('/dismiss')) {
        return json(200, { operation_id: url.split('/')[3], dismissed: true });
      }
      return json(404, { error: { code: 'NOT_FOUND', message: url } });
    }),
  );
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

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('Board', () => {
  function renderBoard(onOpenRecovery = vi.fn()): typeof onOpenRecovery {
    mockFetch({ operations: [editOp, fileOp, deleteOp], writes: [] });
    render(
      wrap(<TaskBoard projectId="inbox" onOpenCard={vi.fn()} onOpenRecovery={onOpenRecovery} />),
    );
    return onOpenRecovery;
  }

  it('a task blocked by a comment operation keeps its card, with a warning edge, the badge and Review', async () => {
    const onOpenRecovery = renderBoard();
    const blocked = await screen.findByRole('article', { name: 'Blocked task' });
    await waitFor(() => expect(blocked.classList.contains('is-blocked')).toBe(true));
    expect(within(blocked).getByText('Recovery required')).toBeTruthy();
    expect(blocked.getAttribute('draggable')).toBe('false');
    fireEvent.click(within(blocked).getByRole('button', { name: 'Review' }));
    expect(onOpenRecovery).toHaveBeenCalledWith(EDIT_OP);
    const plain = screen.getByRole('article', { name: 'Plain task' });
    expect(plain.classList.contains('is-blocked')).toBe(false);
    expect(within(plain).queryByText('Recovery required')).toBeNull();
  });

  it('a moving card stays dimmed in its source column with Moving… and its destination', async () => {
    renderBoard();
    const column = await screen.findByRole('region', { name: 'In progress' });
    const moving = within(column).getByRole('article', { name: 'Moving task' });
    await waitFor(() => expect(moving.classList.contains('is-moving')).toBe(true));
    expect(within(moving).getByText('Moving…')).toBeTruthy();
    expect(within(moving).getByText('to Backlogger')).toBeTruthy();
    expect(within(moving).queryByRole('button', { name: 'Review' })).toBeNull();
    expect(moving.getAttribute('draggable')).toBe('false');
  });

  it('an item hidden by a stopped deletion has no card; one notice above the columns names it', async () => {
    const onOpenRecovery = renderBoard();
    const notice = await screen.findByRole('note', { name: 'Hidden items' });
    expect(notice.textContent).toContain(
      '1 item in this project is hidden while deletion is stopped.',
    );
    expect(notice.textContent).toContain('Hidden task');
    expect(screen.queryByRole('article', { name: 'Hidden task' })).toBeNull();
    fireEvent.click(within(notice).getByRole('button', { name: 'Review' }));
    expect(onOpenRecovery).toHaveBeenCalledWith(DELETE_OP);
  });
});

describe('Current work', () => {
  it('a blocked row gets the warning edge, the badge, "Comment writes paused" and Review', async () => {
    mockFetch({ operations: [editOp], writes: [] });
    const onOpenRecovery = vi.fn();
    render(
      wrap(
        <CurrentWorkDrawer
          onOpenTask={vi.fn()}
          onGoToBoard={vi.fn()}
          onOpenRecovery={onOpenRecovery}
          onClose={vi.fn()}
        />,
      ),
    );
    const title = await screen.findByRole('button', { name: 'Blocked task' });
    const row = title.closest('li')!;
    await waitFor(() => expect(row.classList.contains('is-blocked')).toBe(true));
    expect(within(row).getByText('Recovery required')).toBeTruthy();
    expect(within(row).getByText('Comment writes paused')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Review' }));
    expect(onOpenRecovery).toHaveBeenCalledWith(EDIT_OP);
    const plain = screen.getByRole('button', { name: 'Plain task' }).closest('li')!;
    expect(within(plain).queryByText('Comment writes paused')).toBeNull();
  });
});

describe('Task workspace', () => {
  function renderTask(server: Server, onOpenRecovery = vi.fn()): typeof onOpenRecovery {
    mockFetch(server);
    render(
      wrap(
        <DocumentWorkspace
          projectId="inbox"
          documentId={BLOCKED}
          theme="dark"
          onDeleted={vi.fn()}
          onOpenRecovery={onOpenRecovery}
        />,
      ),
    );
    return onOpenRecovery;
  }

  async function openComments(): Promise<void> {
    await userEvent.click(await screen.findByRole('tab', { name: /Comments/ }));
  }

  it('a post refused with RECOVERY_REQUIRED keeps the draft, pauses the composer and shows the notice', async () => {
    const server: Server = { operations: [], writes: [recoveryRequired(EDIT_OP)] };
    const onOpenRecovery = renderTask(server);
    await openComments();
    const composer = await screen.findByRole('textbox', { name: 'New comment' });
    await userEvent.type(composer, 'My unsaved finding');
    server.operations = [editOp];
    await userEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    const notice = await screen.findByRole('note', { name: 'Recovery' });
    expect(notice.textContent).toContain('A comment change needs your review.');
    expect(notice.textContent).toContain(
      'Comment writes, archive, filing and deletion are paused for this task. You can still read everything.',
    );
    const paused = screen.getByRole('textbox', { name: 'New comment' }) as HTMLTextAreaElement;
    await waitFor(() => expect(paused.disabled).toBe(true));
    expect(paused.value).toBe('My unsaved finding');
    expect(
      screen.getByText('Writing is paused while recovery is pending. Your draft is kept.'),
    ).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Post comment' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(within(notice).getByRole('button', { name: 'Review recovery' }));
    expect(onOpenRecovery).toHaveBeenCalledWith(EDIT_OP);
  });

  it('a blocked command shows a toast with Review recovery, which takes focus', async () => {
    const server: Server = { operations: [editOp], writes: [recoveryRequired(EDIT_OP)] };
    const onOpenRecovery = renderTask(server);
    await screen.findByRole('note', { name: 'Recovery' });
    await userEvent.click(screen.getByRole('button', { name: /Delete/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const toast = await screen.findByText(
      "Can't delete: a pending operation on this task needs review.",
    );
    const review = within(toast.closest('.toast') as HTMLElement).getByRole('button', {
      name: 'Review recovery',
    });
    await waitFor(() => expect(document.activeElement).toBe(review));
    fireEvent.click(review);
    expect(onOpenRecovery).toHaveBeenCalledWith(EDIT_OP);
  });

  it('a moving task says so, and pauses writing without a link', async () => {
    renderTask({
      operations: [{ ...fileOp, task_id: BLOCKED, task_title: 'Blocked task' }],
      writes: [],
    });
    const notice = await screen.findByRole('note', { name: 'Recovery' });
    // The notice can render before the projects load, naming the id at first.
    await waitFor(() => expect(notice.textContent).toContain('Moving to Backlogger…'));
    expect(notice.textContent).toContain('editing is paused until the move finishes');
    expect(within(notice).queryByRole('button')).toBeNull();
  });

  it('an abandoned change shows a dismissible notice; dismissing it takes the entry off', async () => {
    const abandoned = {
      ...editOp,
      state: 'abandoned' as const,
      abandoned_at: '2026-10-21T10:07:00Z',
    };
    const server: Server = { operations: [abandoned], writes: [] };
    renderTask(server);
    const notice = await screen.findByRole('note', { name: 'Recovery' });
    expect(notice.textContent).toContain('Pending change abandoned. The current file was kept.');
    await openComments();
    const composer = (await screen.findByRole('textbox', {
      name: 'New comment',
    })) as HTMLTextAreaElement;
    expect(composer.disabled).toBe(false);
    server.operations = [];
    fireEvent.click(within(notice).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('note', { name: 'Recovery' })).toBeNull());
  });
});
