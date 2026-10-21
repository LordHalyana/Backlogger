import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { Comment, CommentPage } from '@backlogger/shared';
import { ApiError } from '../lib/api.js';
import {
  fetchComment,
  flattenHistory,
  newUuid,
  useCommentHistory,
  useCreateComment,
  useDeleteComment,
  useEditComment,
  type CreateCommentArgs,
} from '../lib/comments.js';
import { useDialog, type DialogApi } from '../lib/dialog.js';
import { useBlockLeave } from '../lib/leave-guard.js';
import { queryKeys } from '../lib/query-keys.js';
import { CommentMarkdown, CommentMeta, firstLine } from './CommentBody.js';
import { CommentComposer, type ComposerError } from './CommentComposer.js';
import { CommentReader, isEditDirty, type EditDraft } from './CommentReader.js';
import { StatusMessage } from './StatusMessage.js';

/** Whether the task's comments can change: archived and read-only tasks are readable only. */
export type CommentWritability = 'writable' | 'archived' | 'read-only';

/** ARIA wiring between a tab and the panel it controls. */
export interface TabPanelIds {
  id: string;
  labelledBy: string;
}

interface CommentsTabProps {
  taskId: string;
  writability: CommentWritability;
  hidden: boolean;
  panel: TabPanelIds;
  /** Unarchive the task (Archived state). */
  onRestoreTask: () => void;
  /** Refetch the task after it changed while a comment was posting. */
  onReloadTask: () => void;
  /** Reports whether a comment draft or edit is unsaved, for the tab's • marker. */
  onDraftChange: (hasDraft: boolean) => void;
}

type FocusTarget =
  | { kind: 'comment'; id: string }
  | { kind: 'reader' | 'edit' | 'delete' | 'keep' | 'add' | 'composer' | 'editor' };

function focusSelector(target: FocusTarget): string {
  switch (target.kind) {
    case 'comment':
      return `[data-testid="comment"][data-comment-id="${target.id}"]`;
    case 'reader':
      return '[data-testid="reader-comment"]';
    case 'composer':
      return 'textarea[data-focus="composer"]';
    case 'editor':
      return 'textarea[data-focus="editor"]';
    default:
      return `[data-focus="${target.kind}"]`;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function hasCode(err: unknown, ...codes: string[]): boolean {
  return err instanceof ApiError && codes.includes(err.code ?? '');
}

/** The task moved, stopped being writable or disappeared while the post was in flight. */
function isTaskChanged(err: unknown): boolean {
  return hasCode(err, 'REVISION_CONFLICT', 'COMMENT_NOT_WRITABLE', 'PARENT_NOT_FOUND');
}

function plural(n: number): string {
  return `${n} ${n === 1 ? 'comment' : 'comments'}`;
}

/** Ask before throwing away unsaved text; resolves true to discard. */
function confirmDiscard(
  dialog: DialogApi,
  what: { title: string; message: string; cancelLabel: string },
): Promise<boolean> {
  return dialog.confirm({ ...what, confirmLabel: 'Discard', danger: true });
}

/**
 * The Comments tab of a backlog item: the history as a full-width thread
 * with the composer docked underneath, and a reader pane for one comment
 * where it is edited, deleted and where edit conflicts are resolved.
 */
export function CommentsTab({
  taskId,
  writability,
  hidden,
  panel,
  onRestoreTask,
  onReloadTask,
  onDraftChange,
}: CommentsTabProps): JSX.Element {
  const dialog = useDialog();
  const qc = useQueryClient();
  const history = useCommentHistory(taskId);
  const createComment = useCreateComment(taskId);
  const editComment = useEditComment(taskId);
  const deleteComment = useDeleteComment(taskId);
  const { comments, total } = flattenHistory(history.data);
  const writable = writability === 'writable';

  const [readerId, setReaderId] = useState<string | null>(null);
  const [composerText, setComposerText] = useState('');
  /** The last post attempt. Retry resends it unchanged, so the server can recognise it. */
  const [postAttempt, setPostAttempt] = useState<CreateCommentArgs | null>(null);
  const [composerError, setComposerError] = useState<ComposerError | null>(null);
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Each message renders as a new node, so a repeated message is announced again.
  const [announcement, setAnnouncementState] = useState({ text: '', seq: 0 });
  const setAnnouncement = useCallback(
    (text: string) => setAnnouncementState((cur) => ({ text, seq: cur.seq + 1 })),
    [],
  );
  // Refs guard against a second submit landing before React re-renders.
  const postingRef = useRef(false);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);

  const hasDraft = composerText !== '' || (edit !== null && isEditDirty(edit));
  useBlockLeave(hasDraft);
  useEffect(() => onDraftChange(hasDraft), [hasDraft, onDraftChange]);

  // Focus moves after an action land once the target element has rendered.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);
  const [, setFocusRequest] = useState(0);
  const focusSoon = useCallback((target: FocusTarget) => {
    pendingFocus.current = target;
    setFocusRequest((n) => n + 1);
  }, []);
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || !rootRef.current) return;
    const el = rootRef.current.querySelector<HTMLElement>(focusSelector(target));
    if (el) {
      el.focus();
      pendingFocus.current = null;
    }
  });

  /** The open edit when it belongs to comment `id`. */
  const editOf = (id: string): EditDraft | null => (edit?.commentId === id ? edit : null);
  /** Another comment is being edited, so `id` cannot be edited or deleted yet. */
  const lockedBy = (id: string): boolean => edit !== null && edit.commentId !== id;

  // ---- Reader --------------------------------------------------------------

  const openReader = useCallback((id: string) => {
    setReaderId(id);
    setConfirmDeleteId(null);
    setDeleteError(null);
  }, []);

  const closeReader = useCallback(() => {
    if (readerId) focusSoon({ kind: 'comment', id: readerId });
    setReaderId(null);
    setConfirmDeleteId(null);
    setDeleteError(null);
  }, [focusSoon, readerId]);

  const onThreadClick = (e: MouseEvent, id: string): void => {
    if ((e.target as Element).closest('a, button')) return;
    openReader(id);
  };

  const onThreadKeyDown = (e: KeyboardEvent, index: number): void => {
    const c = comments[index];
    if (!c) return;
    if (e.key === 'Enter' && e.target === e.currentTarget) {
      e.preventDefault();
      openReader(c.id);
    } else if (readerId && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const next = comments[index + (e.key === 'ArrowDown' ? 1 : -1)];
      if (!next) return;
      e.preventDefault();
      openReader(next.id);
      focusSoon({ kind: 'comment', id: next.id });
    } else if (readerId && e.key === 'Escape') {
      e.preventDefault();
      escapeInReader();
    }
  };

  // ---- Composer ------------------------------------------------------------

  const post = async (): Promise<void> => {
    if (postingRef.current || !writable) return;
    const body = composerText;
    if (body.trim() === '') return;
    const attempt =
      postAttempt && postAttempt.body === body
        ? postAttempt
        : { operationId: newUuid(), commentId: newUuid(), body };
    postingRef.current = true;
    setPostAttempt(attempt);
    setComposerError(null);
    setAnnouncement('Posting comment…');
    try {
      await createComment.mutateAsync(attempt);
      setComposerText('');
      setPostAttempt(null);
      setAnnouncement('Comment posted.');
      focusSoon({ kind: 'comment', id: attempt.commentId });
    } catch (err) {
      if (isTaskChanged(err)) {
        setPostAttempt(null);
        setComposerError({
          kind: 'task-changed',
          message: `The task changed while posting: ${errorMessage(err)}`,
        });
      } else {
        setComposerError({ kind: 'failed', message: `Comment not saved: ${errorMessage(err)}` });
      }
      setAnnouncement('Comment not saved. Your text is kept.');
    } finally {
      postingRef.current = false;
    }
  };

  const leaveComposer = (): void => {
    if (composerText === '') {
      focusSoon({ kind: 'add' });
      return;
    }
    void confirmDiscard(dialog, {
      title: 'Discard comment?',
      message: 'Your unsaved comment will be lost.',
      cancelLabel: 'Keep writing',
    }).then((ok) => {
      if (!ok) return;
      setComposerText('');
      setPostAttempt(null);
      setComposerError(null);
      focusSoon({ kind: 'add' });
    });
  };

  const reloadTask = (): void => {
    setComposerError(null);
    onReloadTask();
    void history.refetch();
  };

  // ---- Edit ----------------------------------------------------------------

  const startEdit = (c: Comment): void => {
    openReader(c.id);
    setEdit({
      commentId: c.id,
      text: c.body,
      baseRevision: c.revision,
      baseBody: c.body,
      attempt: null,
      saving: false,
      error: null,
      conflict: null,
    });
    focusSoon({ kind: 'editor' });
  };

  const cancelEdit = (): void => {
    if (!edit || edit.saving) return;
    const close = (): void => {
      setEdit(null);
      focusSoon({ kind: 'edit' });
    };
    if (!isEditDirty(edit)) {
      close();
      return;
    }
    void confirmDiscard(dialog, {
      title: 'Discard your edit?',
      message: 'Your changes to this comment will be lost.',
      cancelLabel: 'Keep editing',
    }).then((ok) => ok && close());
  };

  const saveEdit = async (): Promise<void> => {
    if (!edit || savingRef.current || edit.conflict) return;
    if (edit.text.trim() === '') {
      setEdit({ ...edit, error: 'A comment needs some text.' });
      return;
    }
    const attempt =
      edit.attempt && edit.attempt.body === edit.text && edit.attempt.revision === edit.baseRevision
        ? edit.attempt
        : { operationId: newUuid(), body: edit.text, revision: edit.baseRevision };
    const draft = { ...edit, attempt, saving: true, error: null };
    savingRef.current = true;
    setEdit(draft);
    try {
      await editComment.mutateAsync({ ...attempt, commentId: draft.commentId });
      setEdit(null);
      setAnnouncement('Comment saved.');
      focusSoon({ kind: 'reader' });
    } catch (err) {
      let failure = err;
      if (hasCode(err, 'REVISION_CONFLICT')) {
        try {
          const current = await fetchComment(draft.commentId);
          setEdit({ ...draft, saving: false, attempt: null, conflict: current });
          setAnnouncement('This comment changed since you started editing. Your edit is kept.');
          return;
        } catch (readErr) {
          failure = readErr;
        }
      }
      setEdit({
        ...draft,
        saving: false,
        error: hasCode(failure, 'COMMENT_NOT_FOUND')
          ? 'This comment was deleted. Copy your text before discarding it.'
          : `Comment not saved: ${errorMessage(failure)}`,
      });
      setAnnouncement('Comment not saved. Your text is kept.');
    } finally {
      savingRef.current = false;
    }
  };

  const continueOnCurrent = (): void => {
    if (!edit?.conflict) return;
    setEdit({
      ...edit,
      baseRevision: edit.conflict.revision,
      baseBody: edit.conflict.body,
      conflict: null,
      error: null,
    });
    focusSoon({ kind: 'editor' });
  };

  const copyMyEdit = (): void => {
    if (!edit) return;
    void navigator.clipboard
      ?.writeText(edit.text)
      .then(() => setAnnouncement('Your edit was copied.'))
      .catch(() => setAnnouncement('Copy failed. Select the text to copy it.'));
  };

  const discardMyEdit = (): void => {
    setEdit(null);
    void history.refetch();
    focusSoon({ kind: 'reader' });
  };

  // ---- Delete --------------------------------------------------------------

  const requestDelete = (id: string): void => {
    setConfirmDeleteId(id);
    setDeleteError(null);
    focusSoon({ kind: 'keep' });
  };

  const keepComment = (): void => {
    setConfirmDeleteId(null);
    focusSoon({ kind: 'delete' });
  };

  const confirmDelete = async (c: Comment): Promise<void> => {
    if (deletingRef.current) return;
    const index = comments.findIndex((x) => x.id === c.id);
    const neighbour = comments[index + 1] ?? comments[index - 1] ?? null;
    deletingRef.current = true;
    setDeleteError(null);
    try {
      await deleteComment.mutateAsync({
        operationId: newUuid(),
        commentId: c.id,
        revision: c.revision,
      });
      setConfirmDeleteId(null);
      // The mutation resolves once the history has refetched.
      const after = flattenHistory(
        qc.getQueryData<InfiniteData<CommentPage, string | null>>(queryKeys.comments(taskId)),
      );
      setAnnouncement(`Comment deleted. ${plural(after.total)}.`);
      if (neighbour) {
        setReaderId(neighbour.id);
        focusSoon({ kind: 'reader' });
      } else {
        setReaderId(null);
        focusSoon({ kind: 'add' });
      }
    } catch (err) {
      setConfirmDeleteId(null);
      setDeleteError(
        hasCode(err, 'REVISION_CONFLICT')
          ? 'This comment changed since you opened it. Review it before deleting.'
          : `Comment not deleted: ${errorMessage(err)}`,
      );
      setAnnouncement('Comment not deleted.');
    } finally {
      deletingRef.current = false;
    }
  };

  /** Esc steps back one layer: the delete confirmation, then the edit, then the reader. */
  function escapeInReader(): void {
    if (confirmDeleteId) keepComment();
    else if (readerId && editOf(readerId)) cancelEdit();
    else closeReader();
  }

  const onReaderKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    escapeInReader();
  };

  // ---- Load older ----------------------------------------------------------

  const loadOlder = async (): Promise<void> => {
    const res = await history.fetchNextPage();
    if (res.isError) {
      setAnnouncement('Older comments could not be loaded.');
      return;
    }
    const next = flattenHistory(res.data);
    setAnnouncement(`Showing ${next.comments.length} of ${next.total}`);
    const first = next.comments[0];
    if (first && next.comments.length > comments.length) {
      focusSoon({ kind: 'comment', id: first.id });
    }
  };

  // ---- Render --------------------------------------------------------------

  const reader = readerId ? (comments.find((c) => c.id === readerId) ?? null) : null;
  const readerOpen = readerId !== null;

  return (
    <>
      <div
        ref={rootRef}
        className="comments-tab"
        role="tabpanel"
        id={panel.id}
        aria-labelledby={panel.labelledBy}
        hidden={hidden}
      >
        <div className="comments-toolbar">
          <span className="comments-count">{plural(total)}</span>
          {writable && (
            <button
              type="button"
              className="btn btn--sm"
              data-focus="add"
              onClick={() => focusSoon({ kind: 'composer' })}
            >
              Add comment
            </button>
          )}
        </div>

        {writability === 'archived' && (
          <div className="comments-notice" role="note">
            <p>
              This task is archived. Its comments can be read, but not changed until you restore it.
            </p>
            <button type="button" className="btn btn--sm" onClick={onRestoreTask}>
              Restore task
            </button>
          </div>
        )}
        {writability === 'read-only' && (
          <div className="comments-notice" role="note">
            <p>This project is read-only. Its comments can be read, but not changed.</p>
          </div>
        )}

        <div className="comments-body">
          <div
            className={'comments-thread' + (readerOpen ? ' is-narrow' : '')}
            data-testid="comments-thread"
          >
            {history.isLoading ? (
              <StatusMessage kind="loading">Loading comments…</StatusMessage>
            ) : history.isError ? (
              <StatusMessage kind="error">
                Failed to load comments: {errorMessage(history.error)}
              </StatusMessage>
            ) : comments.length === 0 ? (
              <div className="comments-empty">
                <p>No comments yet.</p>
                <p className="comments-hint">
                  Record findings, decisions, attempts and progress on this task.
                </p>
              </div>
            ) : (
              <>
                {history.hasNextPage && (
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost comments-load-older"
                    disabled={history.isFetchingNextPage}
                    onClick={() => void loadOlder()}
                  >
                    {history.isFetchingNextPage ? 'Loading…' : 'Load older comments'}
                  </button>
                )}
                {comments.map((c, i) => (
                  <article
                    key={c.id}
                    data-testid="comment"
                    data-comment-id={c.id}
                    tabIndex={0}
                    aria-current={c.id === readerId ? 'true' : undefined}
                    className={'comment-block' + (c.id === readerId ? ' is-selected' : '')}
                    onClick={(e) => onThreadClick(e, c.id)}
                    onKeyDown={(e) => onThreadKeyDown(e, i)}
                  >
                    <header className="comment-meta">
                      <CommentMeta comment={c} />
                      {writable && !readerOpen && (
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost comment-edit-inline"
                          disabled={lockedBy(c.id)}
                          onClick={() => startEdit(c)}
                        >
                          Edit
                        </button>
                      )}
                    </header>
                    {readerOpen ? (
                      <span className="comment-row-text">{firstLine(c.body)}</span>
                    ) : (
                      <CommentMarkdown body={c.body} />
                    )}
                  </article>
                ))}
              </>
            )}
          </div>

          {readerId && (
            <CommentReader
              comment={reader}
              edit={editOf(readerId)}
              writable={writable}
              locked={lockedBy(readerId)}
              confirmingDelete={confirmDeleteId === readerId}
              deleting={deleteComment.isPending}
              deleteError={deleteError}
              onKeyDown={onReaderKeyDown}
              onClose={closeReader}
              onStartEdit={() => reader && startEdit(reader)}
              onEditText={(text) => edit && setEdit({ ...edit, text, error: null })}
              onSaveEdit={() => void saveEdit()}
              onCancelEdit={cancelEdit}
              onContinueOnCurrent={continueOnCurrent}
              onCopyMyEdit={copyMyEdit}
              onDiscardMyEdit={discardMyEdit}
              onRequestDelete={() => requestDelete(readerId)}
              onKeep={keepComment}
              onConfirmDelete={() => reader && void confirmDelete(reader)}
            />
          )}
        </div>

        {writable && (
          <CommentComposer
            text={composerText}
            posting={createComment.isPending}
            error={composerError}
            canRetry={composerError?.kind === 'failed' && postAttempt?.body === composerText}
            onText={setComposerText}
            onPost={() => void post()}
            onEscape={leaveComposer}
            onReloadTask={reloadTask}
          />
        )}
      </div>
      {/* Outside the tab panel, so results still announce after switching to Description. */}
      <div className="visually-hidden" aria-live="polite" data-testid="comments-live">
        <span key={announcement.seq}>{announcement.text}</span>
      </div>
    </>
  );
}
