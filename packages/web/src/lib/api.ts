import type { ApiErrorBody } from '@backlogger/shared';

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const errBody = body as ApiErrorBody | undefined;
    const code = errBody?.error?.code ?? 'HTTP_ERROR';
    const message = errBody?.error?.message ?? `Request failed: ${res.status}`;
    throw new ApiError(res.status, code, message, errBody?.error?.details);
  }
  return body as T;
}
