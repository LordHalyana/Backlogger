import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

function mockSearch(hits: SearchHit[]): string[] {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      urls.push(url);
      return new Response(JSON.stringify(hits), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return urls;
}

function renderPalette(onOpenDocument = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CommandPalette open onClose={() => undefined} onOpenDocument={onOpenDocument} />
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
    expect(onOpen).toHaveBeenCalledWith('work', '00000000-0000-4000-8000-000000000003');
  });
});
