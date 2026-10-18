import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Document } from '@backlogger/shared';
import { DocumentWorkspace } from './DocumentWorkspace.js';
import { DialogProvider } from '../lib/dialog.js';
import { documentKey } from '../lib/documents.js';

const initialDoc: Document = {
  id: '11111111-2222-3333-4444-555555555555',
  project_id: 'aa',
  title: 'Hello',
  type: 'note',
  status: 'draft',
  path: 'aa/notes/hello-11111111.md',
  tags: [],
  readOnly: false,
  created_at: '2026-05-01T00:00:00.000Z',
  updated_at: '2026-05-01T00:00:00.000Z',
  revision: 'rev-1',
  body: 'first line\n',
};

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function setupFetchMock(doc: Document = initialDoc): {
  calls: FetchCall[];
  setUpdateResponse: (doc: Document) => void;
} {
  const calls: FetchCall[] = [];
  let nextUpdate: Document = { ...doc };

  // Stub the global fetch. The workspace only hits GET + PUT for documents
  // (project list queries aren't triggered by this component).
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });

    if (url === `/api/documents/${doc.id}` && (!init || init.method === undefined)) {
      return new Response(JSON.stringify(doc), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === `/api/documents/${doc.id}` && init?.method === 'PUT') {
      return new Response(JSON.stringify(nextUpdate), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: url } }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);

  return {
    calls,
    setUpdateResponse: (doc) => {
      nextUpdate = doc;
    },
  };
}

function renderWorkspace(): {
  onDeleted: ReturnType<typeof vi.fn>;
  qc: QueryClient;
} {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onDeleted = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <DialogProvider>
        <DocumentWorkspace
          projectId="aa"
          documentId={initialDoc.id}
          theme="dark"
          onDeleted={onDeleted}
        />
      </DialogProvider>
    </QueryClientProvider>,
  );
  return { onDeleted, qc };
}

describe('DocumentWorkspace dirty → save → clean flow', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    cleanup();
  });

  it('marks dirty on metadata edit, then saves after debounce, then clean', async () => {
    const { calls, setUpdateResponse } = setupFetchMock();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWorkspace();

    // Wait for the initial GET to resolve and the panel to render the title.
    const titleInput = await screen.findByDisplayValue('Hello');
    expect(screen.getByText(/Saved/)).toBeTruthy();

    // Edit the title via the metadata panel.
    await user.clear(titleInput);
    await user.type(titleInput, 'World');
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy();

    // Prepare the server's PUT response (new updated_at).
    const updated: Document = {
      ...initialDoc,
      title: 'World',
      updated_at: '2026-05-01T00:00:01.000Z',
      revision: 'rev-2',
    };
    setUpdateResponse(updated);

    // Advance past the 800ms debounce.
    await act(async () => {
      vi.advanceTimersByTime(900);
    });

    await waitFor(() => {
      expect(screen.getByText(/Saved/)).toBeTruthy();
    });

    const putCall = calls.find((c) => c.init?.method === 'PUT');
    expect(putCall).toBeDefined();
    expect(putCall!.init!.headers).toMatchObject({ 'If-Match': initialDoc.revision });
    const sentBody = JSON.parse(putCall!.init!.body as string) as { title: string };
    expect(sentBody.title).toBe('World');
  });

  it('shows derived plain Markdown documents as read-only', async () => {
    const readOnlyDoc: Document = {
      ...initialDoc,
      readOnly: true,
      path: 'aa/external/getting-started.md',
    };
    setupFetchMock(readOnlyDoc);
    renderWorkspace();

    const titleInput = await screen.findByDisplayValue('Hello');
    expect(screen.getByText('Read-only')).toBeTruthy();
    expect(screen.getByText(/Read-only derived document/)).toBeTruthy();
    expect((titleInput as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Delete document/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Archive/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps local metadata edits when the document cache refetches the same version', async () => {
    setupFetchMock();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { qc } = renderWorkspace();

    const titleInput = await screen.findByDisplayValue('Hello');
    await user.clear(titleInput);
    await user.type(titleInput, 'Local Draft');
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy();

    act(() => {
      qc.setQueryData(documentKey(initialDoc.id), {
        ...initialDoc,
        title: 'Server Same Version',
      });
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Local Draft')).toBeTruthy();
      expect(screen.getByText(/Unsaved changes/)).toBeTruthy();
    });
  });

  it('rebases local metadata when the document cache receives a newer version', async () => {
    setupFetchMock();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { qc } = renderWorkspace();

    const titleInput = await screen.findByDisplayValue('Hello');
    await user.clear(titleInput);
    await user.type(titleInput, 'Local Draft');
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy();

    act(() => {
      qc.setQueryData(documentKey(initialDoc.id), {
        ...initialDoc,
        title: 'Remote Update',
        updated_at: '2026-05-01T00:00:02.000Z',
        revision: 'rev-3',
      });
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Remote Update')).toBeTruthy();
      expect(screen.getByText(/Saved/)).toBeTruthy();
    });
  });
});
