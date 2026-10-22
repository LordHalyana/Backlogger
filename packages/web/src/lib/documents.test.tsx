import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { DeleteDocumentAck } from '@backlogger/shared';
import { useDeleteDocument } from './documents.js';
import { queryKeys } from './query-keys.js';

const TASK = '00000000-0000-4000-8000-000000000001';
const KEY = '00000000-0000-4000-8000-0000000000aa';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useDeleteDocument', () => {
  it('clears search results, so a deleted task leaves them (#70)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ outcome: 'deleted' })),
    );
    const qc = new QueryClient();
    const key = [...queryKeys.search(), 'zebracorn', null, 20];
    qc.setQueryData(key, []);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDeleteDocument('work'), { wrapper });

    await act(() =>
      result.current.mutateAsync({ id: TASK, operationId: KEY }),
    );
    expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
  });

  it('sends the Idempotency-Key it is given and returns the acknowledgement (#73)', async () => {
    const ack: DeleteDocumentAck = {
      operation_id: KEY,
      command: 'document.delete',
      document_id: TASK,
      project_id: 'work',
      outcome: 'deleted',
      result_revision: null,
    };
    const fetch = vi.fn(async () => Response.json(ack));
    vi.stubGlobal('fetch', fetch);
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDeleteDocument('work'), { wrapper });

    const returned = await act(() => result.current.mutateAsync({ id: TASK, operationId: KEY }));

    expect(returned).toEqual(ack);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/documents/${TASK}`);
    expect(init.method).toBe('DELETE');
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe(KEY);
  });

  it('refetches the lists after a failed delete, which may have left a pending deletion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: { code: 'INTERNAL', message: 'boom' } }, { status: 500 }),
      ),
    );
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.documents('work'), []);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDeleteDocument('work'), { wrapper });

    await act(() =>
      result.current.mutateAsync({ id: TASK, operationId: KEY }).catch(() => undefined),
    );
    expect(qc.getQueryState(queryKeys.documents('work'))?.isInvalidated).toBe(true);
  });
});
