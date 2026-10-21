import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { renderMarkdown, type Comment } from '@backlogger/shared';
import { ApiError } from '../lib/api.js';
import {
  createComment,
  deleteComment,
  editComment,
  fetchComment,
  flattenHistory,
  newUuid,
  useCommentHistory,
} from '../lib/comments.js';
import { useDialog } from '../lib/dialog.js';
import { useBlockLeave } from '../lib/leave-guard.js';
import { Icon } from './Icon.js';
import { StatusMessage } from './StatusMessage.js';

/** Whether the task's comments can change: archived and read-only tasks are readable only. */
export type CommentWritability = 'writable' | 'archived' | 'read-only';

interface CommentsTabProps {
  taskId: string;
  writability: CommentWritability;
  hidden: boolean;
  /** ARIA tab-panel wiring. */
  panelId: string;
  labelledBy: string;
  /** Unarchive the task (Archived state). */
  onRestoreTask: () => void;
  /** Refetch the task after it changed while a comment was posting. */
  onReloadTask: () => void;
  /** Reports whether a comment draft or edit is unsaved, for the tab's • marker. */
  onDraftChange: (hasDraft: boolean) => void;
}

/** One post attempt. Retry resends it unchanged, so the server can recognise it. */
interface PostAttempt {
  operationId: string;
  commentId: string;
  body: string;
}

interface ComposerError {
  /** `task-changed`: the task moved, was archived or went away while posting. */
  kind: 'failed' | 'task-changed';
  message: string;
}

interface EditDraft {
  commentId: string;
  text: string;
  /** The version being edited: If-Match, and what "unchanged" means. */
  baseRevision: string;
  baseBody: string;
  /** The last save attempt; Retry reuses its key while text and base are unchanged. */
  attempt: { operationId: string; body: string; revision: string } | null;
  saving: boolean;
  error: string | null;
  /** The current saved version after a REVISION_CONFLICT. */
  conflict: Comment | null;
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

function isSubmitKey(e: KeyboardEvent): boolean {
  return e.key === 'Enter' && (e.ctrlKey || e.metaKey);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The task moved, stopped being writable or disappeared while the post was in flight. */
function isTaskChanged(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return (
    err.code === 'REVISION_CONFLICT' ||
    err.code === 'COMMENT_NOT_WRITABLE' ||
    err.code === 'PARENT_NOT_FOUND'
  );
}

function plural(n: number): string {
  return `${n} ${n === 1 ? 'comment' : 'comments'}`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function firstLine(body: string): string {
  return (
    body
      .split('\n')
      .find((l) => l.trim() !== '')
      ?.trim() ?? ''
  );
}

function isEdited(c: Comment): boolean {
  return c.updated_at !== c.created_at;
}

function CommentMeta({ comment }: { comment: Comment }): JSX.Element {
  return (
    <>
      <time dateTime={comment.created_at} title={comment.created_at}>
        {formatWhen(comment.created_at)}
      </time>
      {isEdited(comment) && (
        <span className="comment-edited" title={`Edited ${formatWhen(comment.updated_at)}`}>
          edited
        </span>
      )}
    </>
  );
}

function MarkdownBody({
  body,
  className = '',
  ...rest
}: {
  body: string;
  className?: string;
  'data-testid'?: string;
  tabIndex?: number;
}): JSX.Element {
  const html = useMemo(() => renderMarkdown(body), [body]);
  return (
    <div
      className={'markdown-body comment-body ' + className}
      dangerouslySetInnerHTML={{ __html: html }}
      {...rest}
    />
  );
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
  panelId,
  labelledBy,
  onRestoreTask,
  onReloadTask,
  onDraftChange,
}: CommentsTabProps): JSX.Element {
  const dialog = useDialog();
  const history = useCommentHistory(taskId);
  const { comments, total } = flattenHistory(history.data);
  const writable = writability === 'writable';

  const [readerId, setReaderId] = useState<string | null>(null);
  const [composerText, setComposerText] = useState('');
  const [postAttempt, setPostAttempt] = useState<PostAttempt | null>(null);
  const [posting, setPosting] = useState(false);
  const [composerError, setComposerError] = useState<ComposerError | null>(null);
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
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

  const hasDraft =
    composerText !== '' ||
    (edit !== null && (edit.text !== edit.baseBody || edit.conflict !== null));
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

  const refetchHistory = useCallback(async () => {
    const res = await history.refetch();
    return flattenHistory(res.data);
  }, [history]);

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
    setPosting(true);
    setPostAttempt(attempt);
    setComposerError(null);
    setAnnouncement('Posting comment…');
    try {
      await createComment(taskId, attempt);
      setComposerText('');
      setPostAttempt(null);
      await refetchHistory();
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
      setPosting(false);
    }
  };

  const onComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isSubmitKey(e)) {
      e.preventDefault();
      void post();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (posting) return;
      if (composerText === '') {
        focusSoon({ kind: 'add' });
        return;
      }
      void dialog
        .confirm({
          title: 'Discard comment?',
          message: 'Your unsaved comment will be lost.',
          confirmLabel: 'Discard',
          cancelLabel: 'Keep writing',
          danger: true,
        })
        .then((ok) => {
          if (!ok) return;
          setComposerText('');
          setPostAttempt(null);
          setComposerError(null);
          focusSoon({ kind: 'add' });
        });
    }
  };

  const reloadTask = (): void => {
    setComposerError(null);
    onReloadTask();
    void refetchHistory();
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
    if (edit.text === edit.baseBody && !edit.conflict) {
      close();
      return;
    }
    void dialog
      .confirm({
        title: 'Discard your edit?',
        message: 'Your changes to this comment will be lost.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        danger: true,
      })
      .then((ok) => ok && close());
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
      await editComment({
        operationId: attempt.operationId,
        commentId: draft.commentId,
        revision: attempt.revision,
        body: attempt.body,
      });
      setEdit(null);
      await refetchHistory();
      setAnnouncement('Comment saved.');
      focusSoon({ kind: 'reader' });
    } catch (err) {
      let failure = err;
      if (err instanceof ApiError && err.code === 'REVISION_CONFLICT') {
        try {
          const current = await fetchComment(draft.commentId);
          setEdit({ ...draft, saving: false, attempt: null, conflict: current });
          setAnnouncement('This comment changed since you started editing. Your edit is kept.');
          void refetchHistory();
          return;
        } catch (readErr) {
          failure = readErr;
        }
      }
      const gone = failure instanceof ApiError && failure.code === 'COMMENT_NOT_FOUND';
      setEdit({
        ...draft,
        saving: false,
        error: gone
          ? 'This comment was deleted. Copy your text before discarding it.'
          : `Comment not saved: ${errorMessage(failure)}`,
      });
      setAnnouncement('Comment not saved. Your text is kept.');
    } finally {
      savingRef.current = false;
    }
  };

  const onEditorKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isSubmitKey(e)) {
      e.preventDefault();
      void saveEdit();
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
    void refetchHistory();
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
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteComment({ operationId: newUuid(), commentId: c.id, revision: c.revision });
      setConfirmDeleteId(null);
      const after = await refetchHistory();
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
        err instanceof ApiError && err.code === 'REVISION_CONFLICT'
          ? 'This comment changed since you opened it. Review it before deleting.'
          : `Comment not deleted: ${errorMessage(err)}`,
      );
      setAnnouncement('Comment not deleted.');
      void refetchHistory();
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  /** Esc steps back one layer: the delete confirmation, then the edit, then the reader. */
  function escapeInReader(): void {
    if (confirmDeleteId) keepComment();
    else if (edit && edit.commentId === readerId) cancelEdit();
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
  const narrow = readerId !== null;
  const otherEditOpen = (id: string): boolean => edit !== null && edit.commentId !== id;

  const postLabel = posting
    ? 'Posting…'
    : composerError?.kind === 'failed' && postAttempt?.body === composerText
      ? 'Retry'
      : 'Post comment';

  return (
    <>
      <div
        ref={rootRef}
        className="comments-tab"
        role="tabpanel"
        id={panelId}
        aria-labelledby={labelledBy}
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

        <div className={'comments-body' + (narrow ? ' has-reader' : '')}>
          <div
            className={'comments-thread' + (narrow ? ' is-narrow' : '')}
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
                      {writable && !narrow && (
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost comment-edit-inline"
                          disabled={otherEditOpen(c.id)}
                          onClick={() => startEdit(c)}
                        >
                          Edit
                        </button>
                      )}
                    </header>
                    {narrow ? (
                      <span className="comment-row-text">{firstLine(c.body)}</span>
                    ) : (
                      <MarkdownBody body={c.body} />
                    )}
                  </article>
                ))}
              </>
            )}
          </div>

          {readerId && (
            <section
              className="comment-reader"
              role="region"
              aria-label="Comment reader"
              onKeyDown={onReaderKeyDown}
            >
              <header className="comment-meta">
                {reader && <CommentMeta comment={reader} />}
                <button
                  type="button"
                  className="btn btn--sm btn--ghost comment-reader-close"
                  aria-label="Close reader"
                  title="Close reader"
                  onClick={closeReader}
                >
                  <Icon name="close" />
                </button>
              </header>
              {!reader ? (
                <p className="comments-hint">This comment is no longer available.</p>
              ) : edit && edit.commentId === reader.id && edit.conflict ? (
                <div className="comment-conflict">
                  <p className="error">
                    This comment changed since you started editing. Nothing was overwritten.
                  </p>
                  <h4>Saved version</h4>
                  <MarkdownBody body={edit.conflict.body} className="comment-conflict-current" />
                  <h4>Your edit</h4>
                  <pre className="comment-conflict-mine">{edit.text}</pre>
                  <div className="comment-actions">
                    <button
                      type="button"
                      className="btn btn--sm comment-submit"
                      onClick={continueOnCurrent}
                    >
                      Continue editing on current version
                    </button>
                    <button type="button" className="btn btn--sm" onClick={copyMyEdit}>
                      Copy my edit
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={discardMyEdit}
                    >
                      Discard my edit
                    </button>
                  </div>
                </div>
              ) : edit && edit.commentId === reader.id ? (
                <form
                  className="comment-edit"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveEdit();
                  }}
                >
                  <textarea
                    aria-label="Edit comment"
                    data-focus="editor"
                    value={edit.text}
                    readOnly={edit.saving}
                    onChange={(e) => setEdit({ ...edit, text: e.target.value, error: null })}
                    onKeyDown={onEditorKeyDown}
                  />
                  {edit.error && <p className="error">{edit.error}</p>}
                  <div className="comment-actions">
                    <button
                      type="submit"
                      className="btn btn--sm comment-submit"
                      disabled={edit.saving}
                    >
                      {edit.saving
                        ? 'Saving…'
                        : edit.error && edit.attempt?.body === edit.text
                          ? 'Retry'
                          : 'Save changes'}
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      disabled={edit.saving}
                      onClick={cancelEdit}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <MarkdownBody
                    key={reader.id}
                    body={reader.body}
                    data-testid="reader-comment"
                    tabIndex={-1}
                  />
                  {deleteError && <p className="error">{deleteError}</p>}
                  {writable &&
                    (confirmDeleteId === reader.id ? (
                      <div
                        className="comment-delete-confirm"
                        role="group"
                        aria-label="Confirm delete"
                      >
                        <span>Delete this comment? This cannot be undone.</span>
                        <button
                          type="button"
                          className="btn btn--sm"
                          data-focus="keep"
                          onClick={keepComment}
                        >
                          Keep
                        </button>
                        <button
                          type="button"
                          className="btn btn--sm btn--danger"
                          disabled={deleting}
                          onClick={() => void confirmDelete(reader)}
                        >
                          {deleting ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    ) : (
                      <div className="comment-actions">
                        <button
                          type="button"
                          className="btn btn--sm"
                          data-focus="edit"
                          disabled={otherEditOpen(reader.id)}
                          onClick={() => startEdit(reader)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          data-focus="delete"
                          disabled={otherEditOpen(reader.id)}
                          onClick={() => requestDelete(reader.id)}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                </>
              )}
            </section>
          )}
        </div>

        {writable && (
          <form
            className="comments-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void post();
            }}
          >
            <textarea
              aria-label="New comment"
              data-focus="composer"
              placeholder="Add a comment (Markdown). Ctrl+Enter posts."
              value={composerText}
              readOnly={posting}
              onChange={(e) => setComposerText(e.target.value)}
              onKeyDown={onComposerKeyDown}
            />
            {composerError && (
              <div className="comments-composer-error">
                <span className="error">{composerError.message}</span>
                {composerError.kind === 'task-changed' && (
                  <button type="button" className="btn btn--sm" onClick={reloadTask}>
                    Reload task
                  </button>
                )}
              </div>
            )}
            <div className="comment-actions">
              <button
                type="submit"
                className="btn btn--sm comment-submit"
                disabled={posting || composerText.trim() === ''}
              >
                {postLabel}
              </button>
            </div>
          </form>
        )}
      </div>
      {/* Outside the tab panel, so results still announce after switching to Description. */}
      <div className="visually-hidden" aria-live="polite" data-testid="comments-live">
        <span key={announcement.seq}>{announcement.text}</span>
      </div>
    </>
  );
}
