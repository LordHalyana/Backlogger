import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
    if (url === `/api/documents/${doc.id}` && init?.method === 'DELETE') {
      return Response.json({
        operation_id: new Headers(init.headers).get('Idempotency-Key'),
        command: 'document.delete',
        document_id: doc.id,
        project_id: doc.project_id,
        outcome: 'deleted',
        result_revision: null,
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

interface HeldPut {
  ifMatch: string;
  body: { title: string };
  respond: (status: number, payload: unknown) => void;
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Fetch mock whose PUTs stay pending until the test answers them. */
function setupHeldSaves(doc: Document = initialDoc): { puts: HeldPut[] } {
  const puts: HeldPut[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url !== `/api/documents/${doc.id}`) {
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: url } });
    }
    if (init?.method !== 'PUT') return jsonResponse(200, doc);
    return new Promise<Response>((resolve) => {
      puts.push({
        ifMatch: (init.headers as Record<string, string>)['If-Match']!,
        body: JSON.parse(init.body as string) as { title: string },
        respond: (status, payload) => resolve(jsonResponse(status, payload)),
      });
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { puts };
}

describe('DocumentWorkspace autosave during a delayed save', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    cleanup();
  });

  async function typeAThenHoldSave(): Promise<{
    puts: HeldPut[];
    titleInput: HTMLElement;
    user: ReturnType<typeof userEvent.setup>;
  }> {
    const { puts } = setupHeldSaves();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWorkspace();
    const titleInput = await screen.findByDisplayValue('Hello');
    await user.clear(titleInput);
    await user.type(titleInput, 'A');
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]!.body.title).toBe('A');
    return { puts, titleInput, user };
  }

  it('keeps B in the editor when the save of A returns, then persists B', async () => {
    const { puts, titleInput, user } = await typeAThenHoldSave();

    await user.type(titleInput, 'B');
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    // One active save per document: B waits for A's response.
    expect(puts).toHaveLength(1);

    await act(async () => {
      puts[0]!.respond(200, { ...initialDoc, title: 'A', revision: 'rev-2' });
    });

    await waitFor(() => expect(puts).toHaveLength(2));
    expect(screen.getByDisplayValue('AB')).toBeTruthy();
    expect(puts[1]!.ifMatch).toBe('rev-2');
    expect(puts[1]!.body.title).toBe('AB');

    await act(async () => {
      puts[1]!.respond(200, { ...initialDoc, title: 'AB', revision: 'rev-3' });
    });
    await waitFor(() => expect(screen.getByText(/^Saved$/)).toBeTruthy());
    expect(screen.getByDisplayValue('AB')).toBeTruthy();
    expect(puts).toHaveLength(2);
  });

  it('keeps B unsaved after A succeeds while B is still being typed', async () => {
    const { puts, titleInput, user } = await typeAThenHoldSave();

    await user.type(titleInput, 'B');
    await act(async () => {
      puts[0]!.respond(200, { ...initialDoc, title: 'A', revision: 'rev-2' });
    });

    await waitFor(() => expect(screen.getByText(/Unsaved changes/)).toBeTruthy());
    expect(screen.getByDisplayValue('AB')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]!.ifMatch).toBe('rev-2');
    expect(puts[1]!.body.title).toBe('AB');
  });

  it('keeps unsaved edits on conflict and does not retry them', async () => {
    const { puts, titleInput, user } = await typeAThenHoldSave();

    await user.type(titleInput, 'B');
    await act(async () => {
      puts[0]!.respond(409, { error: { code: 'CONFLICT', message: 'stale' } });
    });

    await screen.findByRole('alert');
    expect(screen.getByDisplayValue('AB')).toBeTruthy();
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy();

    await user.type(titleInput, 'C');
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByDisplayValue('ABC')).toBeTruthy();
    expect(puts).toHaveLength(1);
  });

  it('keeps B visibly unsaved when the save of A fails', async () => {
    const { puts, titleInput, user } = await typeAThenHoldSave();

    await user.type(titleInput, 'B');
    await act(async () => {
      puts[0]!.respond(500, { error: { code: 'INTERNAL', message: 'disk full' } });
    });

    await screen.findByText(/Save failed: disk full/);
    expect(screen.getByDisplayValue('AB')).toBeTruthy();
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy();
  });
});

describe('DocumentWorkspace permanent deletion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it('warns that a backlog item is deleted with its comments, then deletes it with an Idempotency-Key (#73)', async () => {
    const { calls } = setupFetchMock({ ...initialDoc, type: 'backlog_item', title: 'Fix gate' });
    const user = userEvent.setup();
    const { onDeleted } = renderWorkspace();

    await screen.findByDisplayValue('Fix gate');
    await user.click(screen.getByRole('button', { name: /Delete document/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(
      'Delete "Fix gate" and all of its comments? The item and every comment on it are removed permanently. This cannot be undone.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    const del = calls.find((c) => c.init?.method === 'DELETE');
    expect(del?.url).toBe(`/api/documents/${initialDoc.id}`);
    expect(new Headers(del?.init?.headers).get('Idempotency-Key')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('keeps the plain warning for documents that have no comments', async () => {
    setupFetchMock();
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByDisplayValue('Hello');
    await user.click(screen.getByRole('button', { name: /Delete document/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Delete "Hello"? This cannot be undone.');
    expect(dialog.textContent).not.toContain('comment');
  });
});
