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
  const conflictRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const docRef = useRef<Document | null>(null);
  /** Last server version the buffer is known to be rebased on. */
  const serverDocRef = useRef<Document | null>(null);
  /** Bumped on every local edit, so an ack can tell whether it covers the buffer. */
  const generationRef = useRef(0);
  /** The one active save for this hook; later flushes queue behind it. */
  const activeSaveRef = useRef<{ docId: string; generation: number } | null>(null);
  const flushQueuedRef = useRef(false);

  useEffect(() => {
    docRef.current = doc ?? null;
  }, [doc]);

  const markConflict = useCallback((next: boolean) => {
    conflictRef.current = next;
    setConflict(next);
  }, []);

  // The ref is written synchronously so an ack always sees the latest edits.
  const replaceBuffer = useCallback((next: DocumentBuffer | null) => {
    bufferRef.current = next;
    setBuffer(next);
  }, []);

  /** Throw away local edits and show `serverDoc` as saved. */
  const resetTo = useCallback(
    (serverDoc: Document) => {
      serverDocRef.current = serverDoc;
      generationRef.current += 1;
      flushQueuedRef.current = false;
      replaceBuffer(bufferFromDoc(serverDoc));
      setDirty(false);
      markConflict(false);
      setSaveError(null);
    },
    [replaceBuffer, markConflict],
  );

  // Rebase only when the selected document or server version changes. An
  // active save or an unresolved conflict owns the buffer: the save's own
  // acknowledgement rebases it, and conflicted unsaved edits wait for the user.
  useEffect(() => {
    const current = docRef.current;
    if (!current) return;
    const sameDoc = serverDocRef.current?.id === current.id;
    if (sameDoc && (activeSaveRef.current || conflictRef.current)) return;
    if (sameDoc && bufferRef.current?.baseRevision === current.revision) return;
    resetTo(current);
  }, [doc?.id, doc?.revision, resetTo]);

  const flushRef = useRef<() => void>(() => {});

  const flush = useCallback(() => {
    const current = docRef.current;
    const serverDoc = serverDocRef.current;
    const buf = bufferRef.current;
    if (!buf || !current || !serverDoc || serverDoc.id !== current.id) return;
    if (current.readOnly) return;
    // Conflicted unsaved edits are kept for explicit reconciliation, never resent.
    if (conflictRef.current) return;
    if (activeSaveRef.current) {
      flushQueuedRef.current = true;
      return;
    }
    if (!bufferDiffersFromDoc(buf, serverDoc)) {
      setDirty(false);
      return;
    }
    const save = { docId: current.id, generation: generationRef.current };
    activeSaveRef.current = save;
    flushQueuedRef.current = false;

    /** False when another document opened meanwhile; its queued save may go now. */
    const settle = (): boolean => {
      activeSaveRef.current = null;
      if (serverDocRef.current?.id === save.docId) return true;
      if (flushQueuedRef.current) flushRef.current();
      return false;
    };

    update
      .mutateAsync({
        id: current.id,
        ifMatch: buf.baseRevision,
        input: {
          title: buf.meta.title,
          status: buf.meta.status,
          tags: buf.meta.tags,
          body: buf.body,
        },
      })
      .then(
        (updated) => {
          setDocumentCache(qc, updated);
          if (!settle()) return;
          const local = bufferRef.current;
          if (generationRef.current === save.generation || !local) {
            resetTo(updated);
            return;
          }
          // Newer input arrived while saving: keep it, rebased on the ack.
          serverDocRef.current = updated;
          setSaveError(null);
          replaceBuffer({ ...local, baseRevision: updated.revision });
          if (flushQueuedRef.current) flushRef.current();
        },
        (err: Error) => {
          if (!settle()) return;
          // Queued edits stay visibly unsaved; the next edit tries again.
          flushQueuedRef.current = false;
          if (err instanceof ApiError && err.status === 409) {
            markConflict(true);
          } else {
            setSaveError(err.message);
          }
        },
      );
  }, [qc, update, markConflict, replaceBuffer, resetTo]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const debouncedFlush = useDebouncedCallback(flush, SAVE_DEBOUNCE_MS);

  const edit = useCallback(
    (change: (prev: DocumentBuffer) => DocumentBuffer) => {
      const prev = bufferRef.current;
      if (!prev) return;
      replaceBuffer(change(prev));
      generationRef.current += 1;
      setDirty(true);
      debouncedFlush();
    },
    [replaceBuffer, debouncedFlush],
  );

  const handleBodyChange = useCallback(
    (next: string) => edit((prev) => ({ ...prev, body: next })),
    [edit],
  );

  const handleMetaChange = useCallback(
    (next: DocumentBufferMeta) => edit((prev) => ({ ...prev, meta: next })),
    [edit],
  );

  const resetConflictToDocument = useCallback(() => {
    const current = docRef.current;
    if (current) {
      resetTo(current);
      return;
    }
    markConflict(false);
    replaceBuffer(null);
  }, [resetTo, markConflict, replaceBuffer]);

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
