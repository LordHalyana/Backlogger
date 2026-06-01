import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Document } from '@backlogger/shared';
import {
  documentKey,
  useDeleteDocument,
  useDocument,
  useDocuments,
  useUpdateDocument,
} from '../lib/documents.js';
import { useDebouncedCallback } from '../lib/debounce.js';
import { ApiError } from '../lib/api.js';
import { useDialog } from '../lib/dialog.js';
import { useTitles } from '../lib/links.js';
import type { Theme } from '../lib/theme.js';
import { DocumentPreview } from './DocumentPreview.js';
import { MetadataPanel, type MetadataPanelValue } from './MetadataPanel.js';

const DocumentEditor = lazy(() =>
  import('./DocumentEditor.js').then((m) => ({ default: m.DocumentEditor })),
);

type ViewMode = 'edit' | 'split' | 'preview';

interface DocumentWorkspaceProps {
  projectId: string;
  documentId: string;
  theme: Theme;
  onDeleted: () => void;
  onOpenDocument?: (projectId: string, documentId: string) => void;
}

interface Buffer {
  body: string;
  meta: MetadataPanelValue;
  /** Server `updated_at` this buffer is rebased on. */
  baseUpdatedAt: string;
}

const SAVE_DEBOUNCE_MS = 800;

function bufferFromDoc(doc: Document): Buffer {
  return {
    body: doc.body,
    meta: { title: doc.title, status: doc.status, tags: [...doc.tags] },
    baseUpdatedAt: doc.updated_at,
  };
}

function bufferDiffersFromDoc(buf: Buffer, doc: Document): boolean {
  return (
    buf.body !== doc.body ||
    buf.meta.title !== doc.title ||
    buf.meta.status !== doc.status ||
    buf.meta.tags.length !== doc.tags.length ||
    buf.meta.tags.some((t, i) => doc.tags[i] !== t)
  );
}

export function DocumentWorkspace({
  projectId,
  documentId,
  theme,
  onDeleted,
  onOpenDocument,
}: DocumentWorkspaceProps): JSX.Element {
  const qc = useQueryClient();
  const { data: doc, isLoading, isError, error, refetch } = useDocument(documentId);
  const update = useUpdateDocument(projectId);
  const del = useDeleteDocument(projectId);
  const titlesQuery = useTitles(projectId);
  const wikiTitles = useMemo<readonly string[]>(
    () => titlesQuery.data?.map((t) => t.title) ?? [],
    [titlesQuery.data],
  );
  const docsQuery = useDocuments(projectId);

  const [buffer, setBuffer] = useState<Buffer | null>(null);
  const bufferRef = useRef<Buffer | null>(null);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('split');

  // (Re)initialize buffer whenever the loaded document id/version changes.
  useEffect(() => {
    if (!doc) return;
    const fresh = bufferFromDoc(doc);
    setBuffer(fresh);
    bufferRef.current = fresh;
    setDirty(false);
    setConflict(false);
    setSaveError(null);
  }, [doc?.id, doc?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback(() => {
    const buf = bufferRef.current;
    if (!buf || !doc) return;
    if (!bufferDiffersFromDoc(buf, doc)) {
      setDirty(false);
      return;
    }
    update.mutate(
      {
        id: doc.id,
        ifMatch: buf.baseUpdatedAt,
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
          // The useEffect on doc.updated_at will rebase the buffer.
          qc.setQueryData(documentKey(updated.id), updated);
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
  }, [doc, qc, update]);

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
    (next: MetadataPanelValue) => {
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

  // beforeunload guard while dirty.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const reload = useCallback(() => {
    setConflict(false);
    setBuffer(null);
    bufferRef.current = null;
    void refetch();
  }, [refetch]);

  const dialog = useDialog();
  const handleDelete = useCallback(() => {
    if (!doc) return;
    void dialog
      .confirm({
        title: 'Delete document',
        message: `Delete "${doc.title}"? This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
      })
      .then((ok) => {
        if (!ok) return;
        del.mutate(doc.id, { onSuccess: onDeleted });
      });
  }, [del, dialog, doc, onDeleted]);

  if (isLoading || !doc || !buffer) {
    return (
      <div className="workspace-empty">
        {isError ? <p className="error">Failed to load: {error?.message}</p> : <p>Loading…</p>}
      </div>
    );
  }

  return (
    <div className="document-workspace">
      <div className="workspace-status">
        <span className={'dirty-dot ' + (dirty ? 'dirty' : 'clean')} aria-hidden="true" />
        <span className="status-label">
          {update.isPending ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}
        </span>
        {saveError && <span className="error">Save failed: {saveError}</span>}
        <div className="view-mode-toggle" role="group" aria-label="View mode">
          {(['edit', 'split', 'preview'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={'view-mode-button' + (viewMode === m ? ' active' : '')}
              aria-pressed={viewMode === m}
              onClick={() => setViewMode(m)}
            >
              {m === 'edit' ? 'Edit' : m === 'split' ? 'Split' : 'Preview'}
            </button>
          ))}
        </div>
        {dirty || update.isPending ? (
          <button
            type="button"
            className="download-button"
            disabled
            title="Save unsaved changes before downloading"
          >
            Download
          </button>
        ) : (
          <a
            className="download-button"
            href={`/api/documents/${doc.id}/raw`}
            download
            title="Download as Markdown"
          >
            Download
          </a>
        )}
      </div>
      {conflict && (
        <div className="conflict-banner" role="alert">
          <span>
            This document was modified somewhere else. Reload to see the latest version (your
            local edits will be discarded).
          </span>
          <button type="button" onClick={reload}>
            Reload
          </button>
        </div>
      )}
      <div className={'workspace-grid view-' + viewMode}>
        {viewMode !== 'preview' && (
          <Suspense fallback={<div className="editor-host editor-loading">Loading editor…</div>}>
            <DocumentEditor
              documentKey={doc.id}
              value={buffer.body}
              onChange={handleBodyChange}
              theme={theme}
              wikiTitles={wikiTitles}
            />
          </Suspense>
        )}
        {viewMode !== 'edit' && (
          <DocumentPreview
            body={buffer.body}
            projectId={projectId}
            currentPath={doc.path}
            docs={docsQuery.data}
            onOpenDocument={onOpenDocument}
          />
        )}
        <MetadataPanel
          value={buffer.meta}
          onChange={handleMetaChange}
          documentPath={doc.path}
          documentId={doc.id}
          updatedAt={buffer.baseUpdatedAt}
          onDelete={handleDelete}
          deleting={del.isPending}
          onOpenDocument={onOpenDocument}
        />
      </div>
    </div>
  );
}
