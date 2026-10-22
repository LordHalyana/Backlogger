import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Project } from '@backlogger/shared';
import { ProjectSwitcher } from './ProjectSwitcher.js';
import { DialogProvider } from '../lib/dialog.js';
import { queryKeys } from '../lib/query-keys.js';

function project(id: string, extra: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    description: null,
    readOnly: false,
    metadataMode: 'frontmatter',
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    isInbox: false,
    linked: false,
    ...extra,
  };
}

function renderSwitcher(
  projects: Project[],
  selectedId: string,
  opts: { deleteResponse?: () => Promise<Response>; onOpenRecovery?: (id: string) => void } = {},
): { calls: Array<{ url: string; init: RequestInit | undefined }>; qc: QueryClient } {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init });
      if (url === '/api/projects') return Response.json(projects);
      if (init?.method === 'DELETE' && opts.deleteResponse) return opts.deleteResponse();
      return Response.json({ error: { code: 'NOT_FOUND', message: url } }, { status: 404 });
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(queryKeys.recovery(), { operations: [] });
  render(
    <QueryClientProvider client={qc}>
      <DialogProvider>
        <ProjectSwitcher
          selectedId={selectedId}
          onSelect={vi.fn()}
          onOpenRecovery={opts.onOpenRecovery}
        />
      </DialogProvider>
    </QueryClientProvider>,
  );
  return { calls, qc };
}

async function openDeleteDialog(): Promise<HTMLElement> {
  const user = userEvent.setup();
  await screen.findByRole('option', { name: /work/ });
  await user.click(screen.getByRole('button', { name: 'Project actions' }));
  await user.click(screen.getByRole('menuitem', { name: /Delete project/ }));
  return screen.findByRole('dialog');
}

describe('ProjectSwitcher delete dialog', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('warns that everything in an ordinary project folder is removed', async () => {
    renderSwitcher([project('work')], 'work');
    const dialog = await openDeleteDialog();
    expect(dialog.textContent).toContain(
      'permanently removes the project folder and everything in it',
    );
  });

  it('says a linked project loses only its link, and its files are kept (#87)', async () => {
    renderSwitcher([project('work', { linked: true })], 'work');
    const dialog = await openDeleteDialog();
    expect(dialog.textContent).toContain('deletes the link to its folder');
    expect(dialog.textContent).toContain("The files at the link's target are kept.");
    expect(dialog.textContent).not.toContain('everything in it');
  });

  it('after a failed request, says the deletion may still be pending and opens its review on Recovery (#87)', async () => {
    const onOpenRecovery = vi.fn();
    const { calls, qc } = renderSwitcher([project('work')], 'work', {
      deleteResponse: () => Promise.reject(new TypeError('Failed to fetch')),
      onOpenRecovery,
    });
    const user = userEvent.setup();
    const dialog = await openDeleteDialog();
    await user.type(within(dialog).getByRole('textbox'), 'work');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await screen.findByText(/may still be in progress/);
    await user.click(screen.getByRole('button', { name: 'Open Recovery' }));
    const del = calls.find((c) => c.init?.method === 'DELETE');
    expect(onOpenRecovery).toHaveBeenCalledWith(
      new Headers(del?.init?.headers).get('Idempotency-Key'),
    );
    expect(qc.getQueryState(queryKeys.recovery())?.isInvalidated).toBe(true);
  });
});
