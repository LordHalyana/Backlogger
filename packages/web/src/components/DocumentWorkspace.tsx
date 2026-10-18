import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  useDeleteDocument,
  useDocument,
  useDocuments,
  useMoveDocument,
} from '../lib/documents.js';
import { toastError, useDialog } from '../lib/dialog.js';
import { FolderPathSchema, folderFromDocumentPath, unarchivePath } from '@backlogger/shared';
import { useTitles } from '../lib/links.js';
import type { Theme } from '../lib/theme.js';
import { useDocumentBuffer } from '../hooks/useDocumentBuffer.js';
import { DocumentPreview } from './DocumentPreview.js';
import { MetadataPanel } from './MetadataPanel.js';
import { SegmentedControl } from './SegmentedControl.js';
import { StatusMessage } from './StatusMessage.js';
import { DOCUMENT_STATUS_LABELS } from '../lib/display.js';

const DocumentEditor = lazy(() =>
  import('./DocumentEditor.js').then((m) => ({ default: m.DocumentEditor })),
);

type ViewMode = 'edit' | 'split' | 'preview';

const VIEW_MODE_OPTIONS = [
  { value: 'edit', label: 'Edit' },
  { value: 'split', label: 'Split' },
  { value: 'preview', label: 'Preview' },
] as const;

interface DocumentWorkspaceProps {
  projectId: string;
  documentId: string;
  theme: Theme;
  onDeleted: () => void;
  onOpenDocument?: (projectId: string, documentId: string) => void;
  /** Set when the document was opened from the board: shows "Back to board". */
  onBackToBoard?: () => void;
}

export function DocumentWorkspace({
  projectId,
  documentId,
  theme,
  onDeleted,
  onOpenDocument,
  onBackToBoard,
}: DocumentWorkspaceProps): JSX.Element {
  const { data: doc, isLoading, isError, error, refetch } = useDocument(documentId);
  const del = useDeleteDocument(projectId);
  const moveDoc = useMoveDocument(projectId);
  const titlesQuery = useTitles(projectId);
  const wikiTitles = useMemo<readonly string[]>(
    () => titlesQuery.data?.map((t) => t.title) ?? [],
    [titlesQuery.data],
  );
  const docsQuery = useDocuments(projectId);
  const isReadOnly = doc?.readOnly ?? false;

  const {
    buffer,
    dirty,
    conflict,
    saveError,
    isSaving,
    handleBodyChange,
    handleMetaChange,
    resetConflictToDocument,
  } = useDocumentBuffer(projectId, doc);
  const [viewMode, setViewMode] = useState<ViewMode>('split');

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
    resetConflictToDocument();
    void refetch();
  }, [refetch, resetConflictToDocument]);

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

  const handleMove = useCallback(() => {
    if (!doc) return;
    if (dirty || isSaving) {
      void dialog.confirm({
        title: 'Save first',
        message: 'Save your changes before moving this document.',
        confirmLabel: 'OK',
        cancelLabel: '',
      });
      return;
    }
    const current = folderFromDocumentPath(projectId, unarchivePath(doc.path));
    void dialog
      .prompt({
        title: 'Move document',
        message: `Current folder: ${current || '(root)'}. Enter a destination folder (leave blank for the project root).`,
        defaultValue: current,
        placeholder: 'e.g. notes/ideas',
        confirmLabel: 'Move',
        validate: (v) => {
          const t = v.trim();
          if (t === '') return null;
          return FolderPathSchema.safeParse(t).success
            ? null
            : 'Invalid path - use lowercase letters, numbers, hyphens, and forward slashes only.';
        },
      })
      .then((folder) => {
        if (folder === null) return;
        const target = folder.trim();
        if (target === current) return;
        moveDoc.mutate(
          { id: doc.id, folder: target },
          { onError: (e) => toastError(dialog, 'Failed to move document', e) },
        );
      });
  }, [doc, dirty, isSaving, dialog, projectId, moveDoc]);

  if (isLoading || !doc || !buffer) {
    return (
      <div className="workspace-empty">
        {isError ? (
          <StatusMessage kind="error">Failed to load: {error?.message}</StatusMessage>
        ) : (
          <StatusMessage kind="loading">Loading…</StatusMessage>
        )}
      </div>
    );
  }

  return (
    <div className="document-workspace">
      <div className="workspace-header">
        {onBackToBoard && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={onBackToBoard}>
            Back to board
          </button>
        )}
        <span className="workspace-title" title={doc.path}>
          {buffer.meta.title || 'Untitled'}
        </span>
        <span
          className={'doc-status-chip status-' + buffer.meta.status}
          aria-hidden="true"
        >
          {DOCUMENT_STATUS_LABELS[buffer.meta.status]}
        </span>
        <code className="workspace-path">{doc.path}</code>
      </div>
      <div className="workspace-status">
        <span className={'dirty-dot ' + (dirty ? 'dirty' : 'clean')} aria-hidden="true" />
        <span className="status-label">
          {isReadOnly ? 'Read-only' : isSaving ? 'Saving...' : dirty ? 'Unsaved changes' : 'Saved'}
        </span>
        {saveError && <span className="error">Save failed: {saveError}</span>}
        <SegmentedControl
          className="view-mode-toggle"
          ariaLabel="View mode"
          value={viewMode}
          options={VIEW_MODE_OPTIONS}
          onChange={setViewMode}
        />
        {dirty || isSaving ? (
          <button
            type="button"
            className="btn btn--sm"
            disabled
            title="Save unsaved changes before downloading"
          >
            Download
          </button>
        ) : (
          <a
            className="btn btn--sm"
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
              readOnly={isReadOnly}
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
          updatedAt={doc.updated_at}
          onDelete={handleDelete}
          deleting={del.isPending}
          readOnly={isReadOnly}
          currentFolder={folderFromDocumentPath(projectId, unarchivePath(doc.path))}
          onMove={isReadOnly ? undefined : handleMove}
          moving={moveDoc.isPending}
          onOpenDocument={onOpenDocument}
        />
      </div>
    </div>
  );
}
