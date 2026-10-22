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
  /** Responses for successive document PUTs, in order. */
  putResponses?: Array<{ status: number; body: unknown }>;
}

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Stub fetch for the board and document PUTs. The returned `server.board` is
 * what later board refetches see, so tests can mirror server-side changes.
 */
function mockFetch({
  board = emptyBoard(),
  pending = false,
  pendingMoves = false,
  putResponses = [],
}: MockOptions): FetchCall[] & { server: { board: Board } } {
  const calls = [] as unknown as FetchCall[] & { server: { board: Board } };
  calls.server = { board };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init });
      if (init?.method === 'PUT') {
        if (pendingMoves) return new Promise<Response>(() => undefined);
        const next = putResponses.shift();
        if (next) return json(next.status, next.body);
      }
      if (url === '/api/projects/demo/board') {
        if (pending) return new Promise<Response>(() => undefined);
        return json(200, calls.server.board);
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

  const conflict = {
    status: 409,
    body: { error: { code: 'REVISION_CONFLICT', message: 'Document was modified' } },
  };

  it('puts a card back and shows a conflict banner when its move is rejected', async () => {
    const board = emptyBoard();
    board.columns.todo = [card({ id: 'a', title: 'Contested' })];
    mockFetch({ board, putResponses: [conflict] });
    renderBoard();

    drag(await screen.findByRole('article', { name: /Contested/ }), 'Done');

    expect((await screen.findByRole('alert')).textContent).toMatch(/not saved/);
    const todo = screen.getByRole('region', { name: 'To do' });
    await waitFor(() =>
      expect(within(todo).getByRole('article', { name: /Contested/ })).toBeTruthy(),
    );
    expect(within(screen.getByRole('region', { name: 'Done' })).queryAllByRole('article')).toEqual(
      [],
    );
  });

  it('shows the conflict banner when Undo of an archive is rejected', async () => {
    const board = emptyBoard();
    const finished = card({ id: 'a', title: 'Finished', task_state: 'done' });
    board.columns.done = [finished];
    const calls = mockFetch({
      board,
      putResponses: [
        { status: 200, body: { ...finished, status: 'archived', revision: 'rev-archived' } },
        conflict,
      ],
    });
    renderBoard();

    const done = await screen.findByRole('region', { name: 'Done' });
    calls.server.board = emptyBoard();
    fireEvent.click(within(done).getByRole('button', { name: 'Archive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/not saved/);
    const puts = calls.filter((c) => c.init?.method === 'PUT');
    expect(puts[1]!.init!.headers).toMatchObject({ 'If-Match': 'rev-archived' });
    expect(JSON.parse(puts[1]!.init!.body as string)).toEqual({ status: 'active' });
  });
});
