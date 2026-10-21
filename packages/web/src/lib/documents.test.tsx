import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useDeleteDocument } from './documents.js';
import { queryKeys } from './query-keys.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useDeleteDocument', () => {
  it('clears search results, so a deleted task leaves them (#70)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const qc = new QueryClient();
    const key = [...queryKeys.search(), 'zebracorn', null, 20];
    qc.setQueryData(key, []);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDeleteDocument('work'), { wrapper });

    await act(() => result.current.mutateAsync('00000000-0000-4000-8000-000000000001'));
    expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
  });
});
