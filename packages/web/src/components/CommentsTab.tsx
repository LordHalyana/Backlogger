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
  useCommentsAround,
  useCreateComment,
  useDeleteComment,
  useEditComment,
  type CreateCommentArgs,
} from '../lib/comments.js';
import { useDialog, type DialogApi } from '../lib/dialog.js';
import { useBlockLeave } from '../lib/leave-guard.js';
import { markTerms, type Landing } from '../lib/landing.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
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

/** How long a landed comment stays tinted. */
export const LANDING_TINT_MS = 3000;

/** A landing on one comment of this task. */
export type CommentLanding = Extract<Landing, { kind: 'comment' }>;

interface CommentsTabProps {
  taskId: string;
  /** For the landing announcement. */
  taskTitle: string;
  /** Land on this comment (search result or direct link). */
  landing: CommentLanding | null;
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
  | { kind: 'comment'; id: string; center?: boolean }
  | { kind: 'reader' | 'edit' | 'delete' | 'keep' | 'add' | 'composer' | 'editor' | 'notice' };

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

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function plural(n: number): string {
  return `${n} ${n === 1 ? 'comment' : 'comments'}`;
}

/** The landed comment's classes: its accent edge, and its tint while that lasts. */
function landedClass(tinted: boolean, reduceMotion: boolean): string {
  if (!tinted) return ' is-landed';
  return reduceMotion ? ' is-landed is-tinted-static' : ' is-landed is-tinted';
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
  taskTitle,
  landing,
  writability,
  hidden,
  panel,
  onRestoreTask,
  onReloadTask,
  onDraftChange,
}: CommentsTabProps): JSX.Element {
  const dialog = useDialog();
  const qc = useQueryClient();
  const newest = useCommentHistory(taskId);
  // Set while the thread shows a window around a comment beyond the newest page.
  const [aroundId, setAroundId] = useState<string | null>(null);
  const around = useCommentsAround(taskId, aroundId);
  const history = aroundId ? around : newest;
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
  /** The comment a landing put the From search marker on, and whether its tint still shows. */
  const [landed, setLanded] = useState<{ id: string; tinted: boolean } | null>(null);
  const [missingNotice, setMissingNotice] = useState(false);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  // Refs guard against a second submit landing before React re-renders.
  const postingRef = useRef(false);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);

  const hasDraft = composerText !== '' || (edit !== null && isEditDirty(edit));
  useBlockLeave(hasDraft);
  useEffect(() => onDraftChange(hasDraft), [hasDraft, onDraftChange]);

  // Focus moves after an action land once the target element has rendered,
  // and not before the render holding the request: a render for another
  // update (a query refresh) can commit first, without the state that came
  // with the request, such as the landed comment's marker.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pendingFocus = useRef<{ target: FocusTarget; request: number } | null>(null);
  const focusRequests = useRef(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const focusSoon = useCallback((target: FocusTarget) => {
    focusRequests.current += 1;
    pendingFocus.current = { target, request: focusRequests.current };
    setFocusRequest(focusRequests.current);
  }, []);
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || pending.request > focusRequest || !rootRef.current) return;
    const { target } = pending;
    const el = rootRef.current.querySelector<HTMLElement>(focusSelector(target));
    if (el) {
      if (target.kind === 'comment' && target.center) {
        el.focus({ preventScroll: true });
        el.scrollIntoView?.({ block: 'center' });
      } else {
        el.focus();
      }
      pendingFocus.current = null;
    }
  });

  // ---- Landing -------------------------------------------------------------

  // The landing already resolved, so a refetch does not land again.
  const resolvedLanding = useRef<number | null>(null);
  const tintTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(tintTimer.current), []);

  const land = useCallback(
    (target: CommentLanding, comment: Comment) => {
      resolvedLanding.current = target.key;
      setMissingNotice(false);
      setReaderId(null);
      setLanded({ id: comment.id, tinted: true });
      clearTimeout(tintTimer.current);
      tintTimer.current = setTimeout(
        () => setLanded((cur) => (cur?.id === comment.id ? { ...cur, tinted: false } : cur)),
        LANDING_TINT_MS,
      );
      focusSoon({ kind: 'comment', id: comment.id, center: true });
      setAnnouncement(
        `Opened ${taskTitle}, Comments tab, comment from ${formatDay(comment.created_at)}.` +
          (writability === 'archived' ? ' Task is archived.' : ''),
      );
    },
    [focusSoon, setAnnouncement, taskTitle, writability],
  );

  // A landing looks in the newest page first, then fetches the comment with
  // its neighbours; a comment that no longer exists leaves the newest page
  // with a notice.
  useEffect(() => {
    if (!landing || resolvedLanding.current === landing.key || !newest.data) return;
    const inNewest = flattenHistory(newest.data).comments.find((c) => c.id === landing.commentId);
    if (inNewest) {
      setAroundId(null);
      land(landing, inNewest);
      return;
    }
    if (aroundId !== landing.commentId) {
      setAroundId(landing.commentId);
      return;
    }
    const found = flattenHistory(around.data).comments.find((c) => c.id === landing.commentId);
    if (found) {
      land(landing, found);
    } else if (around.isError) {
      resolvedLanding.current = landing.key;
      if (hasCode(around.error, 'COMMENT_NOT_FOUND')) {
        setAroundId(null);
        setLanded(null);
        setMissingNotice(true);
        focusSoon({ kind: 'notice' });
      }
    }
  }, [landing, newest.data, around.data, around.isError, around.error, aroundId, land, focusSoon]);

  // The comment a window was opened around went away (deleted here or
  // elsewhere): back to the newest comments.
  useEffect(() => {
    if (
      aroundId &&
      resolvedLanding.current === landing?.key &&
      hasCode(around.error, 'COMMENT_NOT_FOUND')
    ) {
      setAroundId(null);
      qc.removeQueries({ queryKey: queryKeys.commentsAround(taskId, aroundId) });
    }
  }, [aroundId, around.error, landing, qc, taskId]);

  const jumpToLatest = (): void => {
    setAroundId(null);
    const latest = flattenHistory(newest.data).comments;
    const last = latest[latest.length - 1];
    setAnnouncement('Showing the newest comments.');
    if (last) focusSoon({ kind: 'comment', id: last.id });
  };

  const showNewer = async (): Promise<void> => {
    const lastShown = comments[comments.length - 1];
    const res = await around.fetchPreviousPage();
    if (res.isError) {
      setAnnouncement('Newer comments could not be loaded.');
      return;
    }
    const next = flattenHistory(res.data).comments;
    const firstNew = lastShown ? next[next.findIndex((c) => c.id === lastShown.id) + 1] : undefined;
    setAnnouncement(`Showing ${next.length} of ${flattenHistory(res.data).total}`);
    if (firstNew) focusSoon({ kind: 'comment', id: firstNew.id });
  };

  // Highlight the query terms in the landed comment once it has rendered.
  const markedLanding = useRef<number | null>(null);
  useEffect(() => {
    if (!landed || !landing || markedLanding.current === landing.key) return;
    const body = rootRef.current?.querySelector<HTMLElement>(
      `[data-comment-id="${landed.id}"] .comment-body`,
    );
    if (!body) return;
    markedLanding.current = landing.key;
    markTerms(body, landing.terms);
  });

  const dismissNotice = (): void => {
    setMissingNotice(false);
    const last = comments[comments.length - 1];
    if (last) focusSoon({ kind: 'comment', id: last.id });
    else if (writable) focusSoon({ kind: 'add' });
  };

  /** The open edit when it belongs to comment `id`. */
  const editOf = (id: string): EditDraft | null => (edit?.commentId === id ? edit : null);
  /** Another comment is being edited, so `id` cannot be edited or deleted yet. */
  const lockedBy = (id: string): boolean => edit !== null && edit.commentId !== id;

  // ---- Reader --------------------------------------------------------------

  const openReader = useCallback((id: string) => {
    // Opening any comment ends the landing's From search marker.
    setLanded(null);
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
      // The new comment is the newest one.
      setAroundId(null);
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
  const pages = history.data?.pages ?? [];
  const olderCount = pages[pages.length - 1]?.older_count ?? 0;
  const newerCount = pages[0]?.newer_count ?? 0;
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
        {missingNotice && (
          <div className="comments-notice" role="status" tabIndex={-1} data-focus="notice">
            <p>
              This comment is no longer available. It may have been deleted. Showing the newest
              comments.
            </p>
            <button type="button" className="btn btn--sm" onClick={dismissNotice}>
              Dismiss
            </button>
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
                  <div className="comments-page-control">
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost comments-load-older"
                      disabled={history.isFetchingNextPage}
                      onClick={() => void loadOlder()}
                    >
                      {history.isFetchingNextPage ? 'Loading…' : 'Load older comments'}
                    </button>
                    {aroundId && <span className="comments-page-count">{olderCount} earlier</span>}
                  </div>
                )}
                {comments.map((c, i) => (
                  <article
                    key={c.id}
                    data-testid="comment"
                    data-comment-id={c.id}
                    tabIndex={0}
                    aria-current={c.id === readerId ? 'true' : undefined}
                    className={
                      'comment-block' +
                      (c.id === readerId ? ' is-selected' : '') +
                      (landed?.id === c.id ? landedClass(landed.tinted, reduceMotion) : '')
                    }
                    onClick={(e) => onThreadClick(e, c.id)}
                    onKeyDown={(e) => onThreadKeyDown(e, i)}
                  >
                    <header className="comment-meta">
                      <CommentMeta comment={c} />
                      {landed?.id === c.id && (
                        <span className="comment-landed-marker">From search</span>
                      )}
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
                {aroundId && (
                  <div className="comments-page-control">
                    {around.hasPreviousPage && (
                      <>
                        <span className="comments-page-count">
                          {plural(newerCount).replace(' ', ' newer ')}
                        </span>
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          disabled={around.isFetchingPreviousPage}
                          onClick={() => void showNewer()}
                        >
                          {around.isFetchingPreviousPage ? 'Loading…' : 'Show newer comments'}
                        </button>
                      </>
                    )}
                    <button type="button" className="btn btn--sm btn--ghost" onClick={jumpToLatest}>
                      Jump to latest
                    </button>
                  </div>
                )}
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
