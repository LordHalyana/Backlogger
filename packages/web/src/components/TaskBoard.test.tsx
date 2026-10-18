import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  /** Leave document PUTs (moves) pending forever. */
  pendingMoves?: boolean;
}

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function mockFetch({
  board = emptyBoard(),
  pending = false,
  pendingMoves = false,
}: MockOptions): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init });
      if (init?.method === 'PUT' && pendingMoves) {
        return new Promise<Response>(() => undefined);
      }
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
  return calls;
}

function fakeDataTransfer(): Partial<DataTransfer> {
  const data = new Map<string, string>();
  return {
    effectAllowed: 'all',
    dropEffect: 'none',
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
  };
}

/** Drag `card` onto the column labelled `label`, as HTML5 drag-and-drop does. */
function drag(card: HTMLElement, label: string): void {
  const dataTransfer = fakeDataTransfer();
  const target = screen.getByRole('region', { name: label });
  fireEvent.dragStart(card, { dataTransfer });
  fireEvent.dragEnter(target, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
  fireEvent.dragEnd(card, { dataTransfer });
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
    board.columns.in_progress = [
      card({ id: 'b', title: 'Build board', task_state: 'in_progress' }),
    ];
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

  it('shows Saving… on a moved card and disables further moves until it settles', async () => {
    const board = emptyBoard();
    board.columns.todo = [card({ id: 'a', title: 'Movable' })];
    const calls = mockFetch({ board, pendingMoves: true });
    renderBoard();

    drag(await screen.findByRole('article', { name: /Movable/ }), 'In progress');

    const inProgress = screen.getByRole('region', { name: 'In progress' });
    const moved = await within(inProgress).findByRole('article', { name: /Movable/ });
    expect(within(moved).getByText('Saving…')).toBeTruthy();
    expect(moved.getAttribute('draggable')).toBe('false');

    const puts = (): FetchCall[] => calls.filter((c) => c.init?.method === 'PUT');
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.url).toBe('/api/documents/a');
    expect(puts()[0]!.init!.headers).toMatchObject({ 'If-Match': 'rev-a' });
    expect(JSON.parse(puts()[0]!.init!.body as string)).toEqual({ task_state: 'in_progress' });

    drag(moved, 'Done');
    expect(within(inProgress).getByRole('article', { name: /Movable/ })).toBeTruthy();
    expect(puts()).toHaveLength(1);
  });
});
