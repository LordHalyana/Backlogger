import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SearchHit } from '@backlogger/shared';
import { CommandPalette } from './CommandPalette.js';

function hit(input: Partial<SearchHit> & Pick<SearchHit, 'id' | 'title'>): SearchHit {
  return {
    project_id: 'work',
    type: 'backlog_item',
    status: 'active',
    task_state: 'todo',
    match: { kind: 'description' },
    snippet: '',
    highlights: [],
    rank: -1,
    ...input,
  };
}

/**
 * Answers searches with `hits`, and a document read with the document in its
 * current project (`moved`), or 404 once it is `deleted`.
 */
function mockSearch(
  hits: SearchHit[],
  opts: { deleted?: string[]; moved?: Record<string, string> } = {},
): string[] {
  const urls: string[] = [];
  const json = (status: number, payload: unknown): Response =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      urls.push(url);
      const doc = /^\/api\/documents\/([^/?]+)$/.exec(url);
      if (doc) {
        const id = doc[1]!;
        if (opts.deleted?.includes(id)) {
          return json(404, { error: { code: 'DOCUMENT_NOT_FOUND', message: 'gone' } });
        }
        const h = hits.find((x) => x.id === id);
        return json(200, { ...h, project_id: opts.moved?.[id] ?? h?.project_id });
      }
      const live = hits.filter(
        (h) => !opts.deleted?.includes(h.id) || !urls.some((u) => u.endsWith(h.id)),
      );
      return json(200, live);
    }),
  );
  return urls;
}

function renderPalette(onOpenDocument = vi.fn(), onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CommandPalette open onClose={onClose} onOpenDocument={onOpenDocument} />
    </QueryClientProvider>,
  );
  return onOpenDocument;
}

async function typeQuery(q: string): Promise<HTMLElement[]> {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: q } });
  return screen.findAllByRole('option', undefined, { timeout: 2000 });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CommandPalette result rows', () => {
  it('shows a comment match: title, project and state, a dated Comment match chip and a highlighted snippet', async () => {
    mockSearch([
      hit({
        id: '00000000-0000-4000-8000-000000000001',
        title: 'Investigate the flaky test',
        task_state: 'in_progress',
        match: {
          kind: 'comment',
          comment_id: '00000000-0000-4000-8000-000000000002',
          created_at: '2026-10-19T16:00:00.000Z',
        },
        snippet: 'Found it: the zebracorn fixture leaks.',
        highlights: [[14, 23]],
      }),
    ]);
    renderPalette();

    const [row] = await typeQuery('zebracorn');
    const r = within(row!);
    expect(r.getByText('Investigate the flaky test')).toBeTruthy();
    expect(r.getByText('work')).toBeTruthy();
    expect(r.getByText('In progress')).toBeTruthy();
    expect(r.queryByText('Archived')).toBeNull();

    const chip = r.getByText(/^Comment match · /);
    expect(chip.textContent).toBe(
      `Comment match · ${new Date('2026-10-19T16:00:00.000Z').toLocaleDateString(undefined, { dateStyle: 'medium' })}`,
    );
    const marks = row!.querySelectorAll('mark');
    expect([...marks].map((m) => m.textContent)).toEqual(['zebracorn']);
    expect(row!.querySelector('.command-palette-row-snippet')?.textContent).toBe(
      'Found it: the zebracorn fixture leaks.',
    );
  });

  it('shows a Description match chip and an Archived chip for an archived task', async () => {
    mockSearch([
      hit({
        id: '00000000-0000-4000-8000-000000000001',
        title: 'Old task',
        status: 'archived',
        task_state: 'done',
        snippet: 'The login suite fails on CI.',
        highlights: [
          [4, 9],
          [16, 21],
        ],
      }),
    ]);
    renderPalette();

    const [row] = await typeQuery('login fail');
    const r = within(row!);
    expect(r.getByText('Description match')).toBeTruthy();
    expect(r.getByText('Archived')).toBeTruthy();
    expect(r.getByText('Done')).toBeTruthy();
    expect([...row!.querySelectorAll('mark')].map((m) => m.textContent)).toEqual([
      'login',
      'fails',
    ]);
  });

  it('labels other document types by type and opens the document on click', async () => {
    mockSearch([
      hit({
        id: '00000000-0000-4000-8000-000000000003',
        title: 'Caching plan',
        type: 'implementation_plan',
        task_state: null,
        snippet: 'cache stampede',
        highlights: [[0, 5]],
      }),
    ]);
    const onOpen = renderPalette();

    const [row] = await typeQuery('cache');
    expect(within(row!).getByText('Implementation plan')).toBeTruthy();
    fireEvent.click(row!);
    await waitFor(() =>
      expect(onOpen).toHaveBeenCalledWith('work', '00000000-0000-4000-8000-000000000003', {
        kind: 'description',
        terms: ['cache'],
      }),
    );
  });
});

describe('CommandPalette opening a result', () => {
  const TASK = '00000000-0000-4000-8000-000000000001';
  const COMMENT = '00000000-0000-4000-8000-000000000002';

  it("lands a comment match on its comment, in the task's current project", async () => {
    mockSearch(
      [
        hit({
          id: TASK,
          title: 'Filed task',
          match: { kind: 'comment', comment_id: COMMENT, created_at: '2026-10-19T16:00:00.000Z' },
          snippet: 'zebracorn',
          highlights: [[0, 9]],
        }),
      ],
      { moved: { [TASK]: 'elsewhere' } },
    );
    const onClose = vi.fn();
    const onOpen = renderPalette(vi.fn(), onClose);
    const [row] = await typeQuery('"zebra" corn*');
    fireEvent.keyDown(row!, { key: 'Enter' });
    await waitFor(() =>
      expect(onOpen).toHaveBeenCalledWith('elsewhere', TASK, {
        kind: 'comment',
        commentId: COMMENT,
        terms: ['zebra', 'corn'],
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("a deleted task's row says so in place and the results refresh; the palette stays open", async () => {
    const urls = mockSearch(
      [
        hit({ id: TASK, title: 'Deleted task', snippet: 'gone', highlights: [] }),
        hit({ id: COMMENT, title: 'Still here', snippet: 'here', highlights: [] }),
      ],
      { deleted: [TASK] },
    );
    const onClose = vi.fn();
    const onOpen = renderPalette(vi.fn(), onClose);
    const [row] = await typeQuery('task');
    const searches = () => urls.filter((u) => u.startsWith('/api/search')).length;
    const before = searches();
    fireEvent.click(row!);

    expect(await screen.findByText('This task is no longer available.')).toBeTruthy();
    await waitFor(() => expect(searches()).toBeGreaterThan(before));
    expect(screen.getByText('Still here')).toBeTruthy();
    expect(screen.queryByText('Deleted task')).toBeNull();
    expect(screen.getByText('This task is no longer available.')).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
