import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Document } from '@backlogger/shared';
import { ApiError, apiFetch } from './api.js';
import { invalidateDocumentDerived, setDocumentCache } from './query-keys.js';

/**
 * A lowercase UUID v4 for one capture attempt. Built from
 * `crypto.getRandomValues`, which (unlike `crypto.randomUUID`) also works
 * when the app is opened over plain HTTP from another device on the LAN.
 */
export function newCaptureId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** What a failed capture tells the user; the typed title is always kept. */
export function captureErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'INBOX_UNAVAILABLE') return 'The Inbox is unavailable; choose a project.';
    if (err.code === 'PROJECT_NOT_WRITABLE') return 'That project cannot take new tasks.';
    return err.message;
  }
  return 'Could not reach the server.';
}

export interface Capture {
  title: string;
  setTitle: (title: string) => void;
  /** Destination project id; `null` is the Inbox. */
  destination: string | null;
  setDestination: (projectId: string | null) => void;
  pending: boolean;
  /** Why the last attempt failed; the next submit is a Retry with the same id. */
  error: string | null;
  /** The item the last successful capture created (or found, on a resend). */
  created: Document | null;
  submit: () => Promise<void>;
}

/**
 * Title-only capture. Each attempt gets a fresh client-chosen id, reused on
 * Retry while the title and destination are unchanged, so a resend after a
 * lost response cannot create a second item. A success clears the title for
 * the next capture.
 */
export function useCapture(initialDestination: string | null = null): Capture {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [destination, setDestination] = useState<string | null>(initialDestination);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Document | null>(null);
  const attempt = useRef<{ id: string; title: string; destination: string | null } | null>(null);
  const inFlight = useRef(false);

  const submit = useCallback(async (): Promise<void> => {
    const trimmed = title.trim();
    if (!trimmed || inFlight.current) return;
    const previous = attempt.current;
    const current =
      previous && previous.title === trimmed && previous.destination === destination
        ? previous
        : { id: newCaptureId(), title: trimmed, destination };
    attempt.current = current;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const doc = await apiFetch<Document>('/api/capture', {
        method: 'POST',
        body: JSON.stringify({
          id: current.id,
          title: current.title,
          ...(current.destination ? { project_id: current.destination } : {}),
        }),
      });
      attempt.current = null;
      setTitle('');
      setCreated(doc);
      setDocumentCache(qc, doc);
      invalidateDocumentDerived(qc, doc.project_id);
    } catch (err) {
      // An id the server will never accept again: the next submit starts over.
      if (err instanceof ApiError && err.code === 'CAPTURE_ID_CONFLICT') attempt.current = null;
      setError(captureErrorMessage(err));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, [destination, qc, title]);

  return {
    title,
    setTitle,
    destination,
    setDestination,
    pending,
    error,
    created,
    submit,
  };
}
