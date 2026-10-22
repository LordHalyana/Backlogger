import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useDeleteDocument, useDocument, useDocuments, useMoveDocument } from '../lib/documents.js';
import { toastError, useDialog } from '../lib/dialog.js';
import {
  FolderPathSchema,
  folderFromDocumentPath,
  unarchivePath,
  type DocumentStatus,
} from '@backlogger/shared';
import { useTitles } from '../lib/links.js';
import type { Theme } from '../lib/theme.js';
import { useDocumentBuffer } from '../hooks/useDocumentBuffer.js';
import { DocumentPreview } from './DocumentPreview.js';
import { MetadataPanel } from './MetadataPanel.js';
import { SegmentedControl } from './SegmentedControl.js';
import { StatusMessage } from './StatusMessage.js';
import { DOCUMENT_STATUS_LABELS } from '../lib/display.js';
import { flattenHistory, newUuid, useCommentHistory } from '../lib/comments.js';
import { CommentsTab, type CommentWritability, type TabPanelIds } from './CommentsTab.js';
import { ApiError } from '../lib/api.js';
import type { Landing } from '../lib/landing.js';
import { useProjects } from '../lib/projects.js';
import {
  isCommentOperation,
  isDeletion,
  isMoving,
  isTransfer,
  operationForTask,
  useDismissRecovery,
  useDeletionUnconfirmedToast,
  useRecoveryBlockedToast,
  useRecoveryList,
} from '../lib/recovery.js';
import type { RecoverySummary } from '@backlogger/shared';

const DocumentEditor = lazy(() =>
  import('./DocumentEditor.js').then((m) => ({ default: m.DocumentEditor })),
);

type ViewMode = 'edit' | 'split' | 'preview';

/** Backlog items have a Description and a Comments tab; other documents only the former. */
type WorkspaceTab = 'description' | 'comments';

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
  /** Set when the document was opened from the board or triage: shows a back link. */
  onBackToBoard?: () => void;
  /** The back link's text; defaults to "Back to board". */
  backLabel?: string;
  /** Land on a comment or on the description's matching paragraph. */
  landing?: Landing | null;
  /** The document lives in another project than `projectId` (a link from before filing). */
  onProjectMoved?: (projectId: string) => void;
  /** Open search, from the page shown when the document no longer exists. */
  onOpenSearch?: () => void;
  /** Open the Recovery page on the operation that pauses this task. */
  onOpenRecovery?: (operationId: string) => void;
}

const noop = (): void => undefined;

export function DocumentWorkspace({
  projectId,
  documentId,
  theme,
  onDeleted,
  onOpenDocument,
  onBackToBoard,
  backLabel = 'Back to board',
  landing = null,
  onProjectMoved,
  onOpenSearch,
  onOpenRecovery = noop,
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
  const recovery = useRecoveryList();
  const taskOperation = operationForTask(recovery.data?.operations, documentId);
  // Every write to the task waits while an operation on it is pending.
  const paused = taskOperation?.state === 'pending';
  const recoveryBlocked = useRecoveryBlockedToast(onOpenRecovery);
  const deletionUnconfirmed = useDeletionUnconfirmedToast(onOpenRecovery);

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

  const isBacklogItem = doc?.type === 'backlog_item';
  // The tab belongs to the document it was chosen on: opening another one starts on Description.
  // A new landing picks its own tab until the user chooses one.
  const [tabChoice, setTabChoice] = useState<{
    documentId: string;
    tab: WorkspaceTab;
    landingKey: number | null;
  }>({ documentId, tab: 'description', landingKey: null });
  const landingTab: WorkspaceTab | null =
    landing && landing.key !== tabChoice.landingKey
      ? landing.kind === 'comment'
        ? 'comments'
        : 'description'
      : null;
  const tab: WorkspaceTab = !isBacklogItem
    ? 'description'
    : (landingTab ?? (tabChoice.documentId === documentId ? tabChoice.tab : 'description'));
  const selectTab = useCallback(
    (next: WorkspaceTab) =>
      setTabChoice({ documentId, tab: next, landingKey: landing?.key ?? null }),
    [documentId, landing],
  );
  const commentHistory = useCommentHistory(documentId, isBacklogItem);
  const commentTotal = flattenHistory(commentHistory.data).total;
  const [commentDraft, setCommentDraft] = useState(false);
  const tabRefs = useRef<Record<WorkspaceTab, HTMLButtonElement | null>>({
    description: null,
    comments: null,
  });
  const onTabKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next: WorkspaceTab = tab === 'description' ? 'comments' : 'description';
      selectTab(next);
      tabRefs.current[next]?.focus();
    },
    [selectTab, tab],
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

  // A link from before the task was filed names its old project: follow the task.
  const movedTo = doc && doc.project_id !== projectId ? doc.project_id : null;
  useEffect(() => {
    if (movedTo) onProjectMoved?.(movedTo);
  }, [movedTo, onProjectMoved]);

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
        message:
          doc.type === 'backlog_item'
            ? `Delete "${doc.title}" and all of its comments? The item and every comment on it are removed permanently. This cannot be undone.`
            : `Delete "${doc.title}"? This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
      })
      .then((ok) => {
        if (!ok) return;
        const operationId = newUuid();
        del.mutate(
          { id: doc.id, operationId },
          {
            onSuccess: onDeleted,
            onError: (e) => {
              if (recoveryBlocked('delete', e) || deletionUnconfirmed(operationId, e)) return;
              toastError(dialog, 'Failed to delete', e);
            },
          },
        );
      });
  }, [del, deletionUnconfirmed, dialog, doc, onDeleted, recoveryBlocked]);

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
          {
            onError: (e) => {
              if (!recoveryBlocked('move', e)) toastError(dialog, 'Failed to move document', e);
            },
          },
        );
      });
  }, [doc, dirty, isSaving, dialog, projectId, moveDoc, recoveryBlocked]);

  if (isError && error instanceof ApiError && error.status === 404) {
    return (
      <div className="workspace-empty item-unavailable">
        <h2>This item is no longer available</h2>
        <p>It may have been deleted. Nothing was recreated.</p>
        {onOpenSearch && (
          <button type="button" className="btn btn--sm" onClick={onOpenSearch}>
            Search
          </button>
        )}
      </div>
    );
  }

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
            {backLabel}
          </button>
        )}
        <span className="workspace-title" title={doc.path}>
          {buffer.meta.title || 'Untitled'}
        </span>
        <span className={'doc-status-chip status-' + buffer.meta.status} aria-hidden="true">
          {DOCUMENT_STATUS_LABELS[buffer.meta.status]}
        </span>
        <code className="workspace-path">{doc.path}</code>
      </div>
      {taskOperation && <RecoveryNotice operation={taskOperation} onReview={onOpenRecovery} />}
      {isBacklogItem && (
        <div className="workspace-tabs" role="tablist" aria-label="Task views">
          {(['description', 'comments'] as const).map((t) => (
            <button
              key={t}
              ref={(el) => {
                tabRefs.current[t] = el;
              }}
              type="button"
              role="tab"
              id={tabPanelIds(doc.id, t).labelledBy}
              aria-selected={tab === t}
              aria-controls={tabPanelIds(doc.id, t).id}
              tabIndex={tab === t ? 0 : -1}
              className={'workspace-tab' + (tab === t ? ' active' : '')}
              onClick={() => selectTab(t)}
              onKeyDown={onTabKeyDown}
            >
              {t === 'description'
                ? 'Description' + (dirty ? ' •' : '')
                : `Comments (${commentTotal})` + (commentDraft ? ' •' : '')}
            </button>
          ))}
        </div>
      )}
      {tab === 'description' && (
        <div className="workspace-status">
          <span className={'dirty-dot ' + (dirty ? 'dirty' : 'clean')} aria-hidden="true" />
          <span className="status-label">
            {isReadOnly
              ? 'Read-only'
              : isSaving
                ? 'Saving...'
                : dirty
                  ? 'Unsaved changes'
                  : 'Saved'}
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
      )}
      {tab === 'description' && conflict && (
        <div className="conflict-banner" role="alert">
          <span>
            This document was modified somewhere else. Reload to see the latest version (your local
            edits will be discarded).
          </span>
          <button type="button" onClick={reload}>
            Reload
          </button>
        </div>
      )}
      <div className={'workspace-grid view-' + (tab === 'comments' ? 'comments' : viewMode)}>
        {tab === 'description' && (
          <div
            className="workspace-description"
            role={isBacklogItem ? 'tabpanel' : undefined}
            id={isBacklogItem ? tabPanelIds(doc.id, 'description').id : undefined}
            aria-labelledby={
              isBacklogItem ? tabPanelIds(doc.id, 'description').labelledBy : undefined
            }
          >
            {viewMode !== 'preview' && (
              <Suspense
                fallback={<div className="editor-host editor-loading">Loading editor…</div>}
              >
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
                landing={landing?.kind === 'description' ? landing : null}
                projectId={projectId}
                currentPath={doc.path}
                docs={docsQuery.data}
                onOpenDocument={onOpenDocument}
              />
            )}
          </div>
        )}
        {isBacklogItem && (
          <CommentsTab
            key={doc.id}
            taskId={doc.id}
            taskTitle={doc.title}
            landing={landing?.kind === 'comment' ? landing : null}
            writability={commentWritability(doc.readOnly, doc.status)}
            paused={paused}
            hidden={tab !== 'comments'}
            panel={tabPanelIds(doc.id, 'comments')}
            onRestoreTask={() => handleMetaChange({ ...buffer.meta, status: 'active' })}
            onReloadTask={reload}
            onDraftChange={setCommentDraft}
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

/**
 * The task's notice while an operation on it is pending: what needs review
 * and what is paused, with Review recovery; a move in progress; or, once a
 * change was abandoned, a notice that stays until dismissed.
 */
function RecoveryNotice({
  operation,
  onReview,
}: {
  operation: RecoverySummary;
  onReview: (operationId: string) => void;
}): JSX.Element {
  const projects = useProjects();
  const dismiss = useDismissRecovery();
  const projectName = (id: string | null): string =>
    projects.data?.find((p) => p.id === id)?.name ?? id ?? '';
  if (operation.state === 'abandoned') {
    return (
      <div className="recovery-task-notice" role="note" aria-label="Recovery">
        <p>
          <strong>Pending change abandoned.</strong> The current file was kept. Comments can be
          written again.
        </p>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={dismiss.isPending}
          onClick={() => dismiss.mutate(operation.operation_id)}
        >
          Dismiss
        </button>
      </div>
    );
  }
  if (isMoving(operation)) {
    return (
      <div className="recovery-task-notice is-info" role="note" aria-label="Recovery">
        <p>
          <strong>Moving to {projectName(operation.target_project_id)}…</strong>; editing is paused
          until the move finishes.
        </p>
      </div>
    );
  }
  const what = isCommentOperation(operation)
    ? 'A comment change needs your review.'
    : isTransfer(operation)
      ? `Filing to ${projectName(operation.target_project_id)} stopped.`
      : isDeletion(operation)
        ? 'Deletion stopped.'
        : 'An operation on this task needs your review.';
  const paused = isCommentOperation(operation)
    ? 'Comment writes, archive, filing and deletion are paused for this task. You can still read everything.'
    : 'Writes to this task are paused until recovery finishes. You can still read everything.';
  return (
    <div className="recovery-task-notice is-warning" role="note" aria-label="Recovery">
      <p>
        <strong>{what}</strong> {paused}
      </p>
      <button
        type="button"
        className="btn btn--sm"
        onClick={() => onReview(operation.operation_id)}
      >
        Review recovery
      </button>
    </div>
  );
}

/** The ids tying a document's tab to its panel. */
function tabPanelIds(documentId: string, tab: WorkspaceTab): TabPanelIds {
  return { id: `${documentId}-panel-${tab}`, labelledBy: `${documentId}-tab-${tab}` };
}

function commentWritability(readOnly: boolean, status: DocumentStatus): CommentWritability {
  if (readOnly) return 'read-only';
  return status === 'archived' ? 'archived' : 'writable';
}
