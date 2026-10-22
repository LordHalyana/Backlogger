import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { FileDocumentAck } from '@backlogger/shared';
import { useFileItem } from './inbox.js';
import { queryKeys } from './query-keys.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const TASK = '00000000-0000-4000-8000-000000000001';
const KEY = '00000000-0000-4000-8000-0000000000aa';

describe('useFileItem', () => {
  it('files with the Idempotency-Key it is given, then refetches the task and its comments (#72)', async () => {
    const ack: FileDocumentAck = {
      operation_id: KEY,
      command: 'document.file',
      document_id: TASK,
      source_project_id: 'inbox',
      target_project_id: 'work',
      outcome: 'filed',
      result_revision: 'r2',
    };
    const fetch = vi.fn(async () => Response.json(ack));
    vi.stubGlobal('fetch', fetch);
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.document(TASK), { id: TASK, project_id: 'inbox', revision: 'r1' });
    qc.setQueryData(queryKeys.comments(TASK), { pages: [] });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useFileItem(), { wrapper });

    const returned = await act(() =>
      result.current.mutateAsync({
        id: TASK,
        revision: 'r1',
        from: 'inbox',
        to: 'work',
        operationId: KEY,
      }),
    );

    expect(returned).toEqual(ack);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/documents/${TASK}/file`);
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe(KEY);
    expect(JSON.parse(String(init.body))).toEqual({ target_project_id: 'work', revision: 'r1' });
    // The ack carries no document: the cached one is refetched, never overwritten.
    expect(qc.getQueryData(queryKeys.document(TASK))).toMatchObject({ revision: 'r1' });
    expect(qc.getQueryState(queryKeys.document(TASK))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(queryKeys.comments(TASK))?.isInvalidated).toBe(true);
  });
});
