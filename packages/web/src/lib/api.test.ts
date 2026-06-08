import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError, apiFetch } from './api';

function mockFetch(status: number, body: string, contentType = 'application/json') {
  return vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(body),
    headers: new Headers({ 'Content-Type': contentType }),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('apiFetch', () => {
  it('returns parsed JSON on a successful response', async () => {
    vi.stubGlobal('fetch', mockFetch(200, JSON.stringify({ id: '1' })));
    const result = await apiFetch<{ id: string }>('/api/test');
    expect(result).toEqual({ id: '1' });
  });

  it('returns undefined for 204 No Content', async () => {
    vi.stubGlobal('fetch', mockFetch(204, ''));
    const result = await apiFetch('/api/test');
    expect(result).toBeUndefined();
  });

  it('throws ApiError with INVALID_JSON when response body is not valid JSON', async () => {
    vi.stubGlobal('fetch', mockFetch(500, 'not json at all'));
    await expect(apiFetch('/api/test')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'INVALID_JSON',
      status: 500,
    });
  });

  it('throws ApiError with structured code from a non-OK JSON error body', async () => {
    const errBody = { error: { code: 'NOT_FOUND', message: 'Document not found' } };
    vi.stubGlobal('fetch', mockFetch(404, JSON.stringify(errBody)));
    await expect(apiFetch('/api/test')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'NOT_FOUND',
      status: 404,
      message: 'Document not found',
    });
  });

  it('falls back to HTTP_ERROR code when non-OK body has no error field', async () => {
    vi.stubGlobal('fetch', mockFetch(503, JSON.stringify({ message: 'down' })));
    await expect(apiFetch('/api/test')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'HTTP_ERROR',
      status: 503,
    });
  });
});
