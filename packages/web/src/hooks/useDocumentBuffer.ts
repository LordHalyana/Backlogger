import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Document } from '@backlogger/shared';
import { ApiError } from '../lib/api.js';
import { useDebouncedCallback } from '../lib/debounce.js';
import { useUpdateDocument } from '../lib/documents.js';
import { setDocumentCache } from '../lib/query-keys.js';

const SAVE_DEBOUNCE_MS = 800;

export interface DocumentBufferMeta {
  title: string;
  status: Document['status'];
  tags: string[];
}

export interface DocumentBuffer {
  body: string;
  meta: DocumentBufferMeta;
  /** Server revision this buffer is rebased on; sent as `If-Match`. */
  baseRevision: string;
}

function bufferFromDoc(doc: Document): DocumentBuffer {
  return {
    body: doc.body,
    meta: { title: doc.title, status: doc.status, tags: [...doc.tags] },
    baseRevision: doc.revision,
  };
}

function bufferDiffersFromDoc(buf: DocumentBuffer, doc: Document): boolean {
  return (
    buf.body !== doc.body ||
    buf.meta.title !== doc.title ||
    buf.meta.status !== doc.status ||
    buf.meta.tags.length !== doc.tags.length ||
    buf.meta.tags.some((t, i) => doc.tags[i] !== t)
  );
}

export function useDocumentBuffer(projectId: string, doc: Document | null | undefined): {
  buffer: DocumentBuffer | null;
  dirty: boolean;
  conflict: boolean;
  saveError: string | null;
  isSaving: boolean;
  handleBodyChange: (next: string) => void;
  handleMetaChange: (next: DocumentBufferMeta) => void;
  resetConflictToDocument: () => void;
} {
  const qc = useQueryClient();
  const update = useUpdateDocument(projectId);
  const [buffer, setBuffer] = useState<DocumentBuffer | null>(null);
  const bufferRef = useRef<DocumentBuffer | null>(null);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const docRef = useRef<Document | null>(null);

  useEffect(() => {
    docRef.current = doc ?? null;
  }, [doc]);

  // Rebase only when the selected document or server version changes.
  useEffect(() => {
    const current = docRef.current;
    if (!current) return;
    const fresh = bufferFromDoc(current);
    setBuffer(fresh);
    bufferRef.current = fresh;
    setDirty(false);
    setConflict(false);
    setSaveError(null);
  }, [doc?.id, doc?.revision]);

  const flush = useCallback(() => {
    const current = docRef.current;
    const buf = bufferRef.current;
    if (!buf || !current) return;
    if (current.readOnly) return;
    if (!bufferDiffersFromDoc(buf, current)) {
      setDirty(false);
      return;
    }
    update.mutate(
      {
        id: current.id,
        ifMatch: buf.baseRevision,
        input: {
          title: buf.meta.title,
          status: buf.meta.status,
          tags: buf.meta.tags,
          body: buf.body,
        },
      },
      {
        onSuccess: (updated) => {
          setDirty(false);
          setSaveError(null);
          // The useEffect on doc.revision will rebase the buffer.
          setDocumentCache(qc, updated);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            setConflict(true);
          } else {
            setSaveError(err.message);
          }
        },
      },
    );
  }, [qc, update]);

  const debouncedFlush = useDebouncedCallback(flush, SAVE_DEBOUNCE_MS);

  const handleBodyChange = useCallback(
    (next: string) => {
      setBuffer((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, body: next };
        bufferRef.current = updated;
        return updated;
      });
      setDirty(true);
      debouncedFlush();
    },
    [debouncedFlush],
  );

  const handleMetaChange = useCallback(
    (next: DocumentBufferMeta) => {
      setBuffer((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, meta: next };
        bufferRef.current = updated;
        return updated;
      });
      setDirty(true);
      debouncedFlush();
    },
    [debouncedFlush],
  );

  const resetConflictToDocument = useCallback(() => {
    const current = docRef.current;
    setConflict(false);
    if (!current) {
      setBuffer(null);
      bufferRef.current = null;
      return;
    }
    const fresh = bufferFromDoc(current);
    setBuffer(fresh);
    bufferRef.current = fresh;
    setDirty(false);
    setSaveError(null);
  }, []);

  return {
    buffer,
    dirty,
    conflict,
    saveError,
    isSaving: update.isPending,
    handleBodyChange,
    handleMetaChange,
    resetConflictToDocument,
  };
}
