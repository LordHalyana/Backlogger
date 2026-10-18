import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Board, BoardCard } from '@backlogger/shared';
import { TaskBoard } from './TaskBoard.js';
import { DialogProvider } from '../lib/dialog.js';

function card(input: Partial<BoardCard> & Pick<BoardCard, 'id' | 'title'>): BoardCard {
  return {
    tags: [],
    status: 'active',
    readOnly: false,
    revision: `rev-${input.id}`,
    task_state: 'todo',
    created_at: '2026-10-01T00:00:00.000Z',
    ...input,
  };
}

function emptyBoard(): Board {
  return { columns: { todo: [], in_progress: [], done: [] } };
}

interface MockOptions {
  board?: Board;
  /** Leave the board request pending forever. */
  pending?: boolean;
}

function mockFetch({ board = emptyBoard(), pending = false }: MockOptions): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/projects/demo/board') {
        if (pending) return new Promise<Response>(() => undefined);
        return new Response(JSON.stringify(board), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: url } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

function renderBoard(): void {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <DialogProvider>
        <TaskBoard projectId="demo" onOpenCard={vi.fn()} />
      </DialogProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('TaskBoard', () => {
  it('shows a loading placeholder while the board loads', async () => {
    mockFetch({ pending: true });
    renderBoard();
    expect(await screen.findByText(/Loading board/)).toBeTruthy();
  });

  it('shows an empty-board message that mentions backlog_item', async () => {
    mockFetch({});
    renderBoard();
    expect(await screen.findByText(/backlog_item/)).toBeTruthy();
  });

  it('renders cards in their columns with a Draft badge and tags', async () => {
    const board = emptyBoard();
    board.columns.todo = [card({ id: 'a', title: 'Write spec', status: 'draft', tags: ['docs'] })];
    board.columns.in_progress = [card({ id: 'b', title: 'Build board', task_state: 'in_progress' })];
    mockFetch({ board });
    renderBoard();

    const todo = await screen.findByRole('region', { name: 'To do' });
    const draftCard = within(todo).getByRole('article', { name: /Write spec/ });
    expect(within(draftCard).getByText('Draft')).toBeTruthy();
    expect(within(draftCard).getByText('docs')).toBeTruthy();

    const inProgress = screen.getByRole('region', { name: 'In progress' });
    const activeCard = within(inProgress).getByRole('article', { name: /Build board/ });
    expect(within(activeCard).queryByText('Draft')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Done' })).queryAllByRole('article')).toEqual(
      [],
    );
  });

  it('marks read-only cards and does not make them draggable', async () => {
    const board = emptyBoard();
    board.columns.todo = [card({ id: 'a', title: 'Mounted', readOnly: true })];
    mockFetch({ board });
    renderBoard();

    const ro = await screen.findByRole('article', { name: /Mounted/ });
    expect(within(ro).getByText('Read-only')).toBeTruthy();
    expect(ro.getAttribute('draggable')).not.toBe('true');
  });
});
