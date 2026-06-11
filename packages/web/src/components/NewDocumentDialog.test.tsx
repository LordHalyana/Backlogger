import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NewDocumentDialog } from './NewDocumentDialog.js';

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function setupFetchMock(): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init });

      if (url === '/api/projects/aa/folders' && init?.method !== 'POST') {
        return jsonResponse([]);
      }
      if (url === '/api/templates') {
        return jsonResponse([]);
      }
      if (url === '/api/projects/aa/folders' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { folder: string };
        return jsonResponse({ folder: body.folder });
      }
      if (url === '/api/projects/aa/documents' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { title: string; type: string; folder: string };
        return jsonResponse({
          id: '11111111-2222-3333-4444-555555555555',
          project_id: 'aa',
          title: body.title,
          type: body.type,
          status: 'draft',
          path: `aa/${body.folder}/test.md`,
          tags: [],
          readOnly: false,
          created_at: '2026-06-11T00:00:00.000Z',
          updated_at: '2026-06-11T00:00:00.000Z',
          body: '',
        });
      }
      return jsonResponse({ error: { code: 'NOT_FOUND', message: url } }, 404);
    }),
  );
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderDialog(): void {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <NewDocumentDialog
        projectId="aa"
        onClose={() => undefined}
        onCreated={() => undefined}
      />
    </QueryClientProvider>,
  );
}

function createCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.url === '/api/projects/aa/documents');
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('NewDocumentDialog', () => {
  it('sends the type default folder explicitly on create', async () => {
    const calls = setupFetchMock();
    renderDialog();

    await userEvent.type(screen.getByLabelText('Document title'), 'Test idea');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createCalls(calls)).toHaveLength(1));
    const body = JSON.parse(String(createCalls(calls)[0]!.init?.body)) as { folder: string };
    expect(body.folder).toBe('ideas');
  });

  it('updates the explicit default folder when the document type changes', async () => {
    const calls = setupFetchMock();
    renderDialog();

    await userEvent.selectOptions(screen.getByLabelText('Document type'), 'finding');
    await userEvent.type(screen.getByLabelText('Document title'), 'Test finding');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createCalls(calls)).toHaveLength(1));
    const body = JSON.parse(String(createCalls(calls)[0]!.init?.body)) as { folder: string };
    expect(body.folder).toBe('notes');
  });
});
