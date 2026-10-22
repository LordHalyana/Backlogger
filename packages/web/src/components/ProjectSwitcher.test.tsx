import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Project } from '@backlogger/shared';
import { ProjectSwitcher } from './ProjectSwitcher.js';
import { DialogProvider } from '../lib/dialog.js';

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

function renderSwitcher(projects: Project[], selectedId: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/projects') return Response.json(projects);
      return Response.json({ error: { code: 'NOT_FOUND', message: url } }, { status: 404 });
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DialogProvider>
        <ProjectSwitcher selectedId={selectedId} onSelect={vi.fn()} />
      </DialogProvider>
    </QueryClientProvider>,
  );
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
});
