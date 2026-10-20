// PROTOTYPE — throwaway, issue #59. Shared pieces the three variants arrange differently.
import { useMemo } from 'react';
import { renderMarkdown } from '@backlogger/shared';
import { useDialog } from '../../lib/dialog.js';
import { fmtTime, type Comment, type Model } from './model.js';

export function Markdown({ body }: { body: string }): JSX.Element {
  const html = useMemo(() => renderMarkdown(body), [body]);
  return <div className="markdown-body pc-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function LiveRegion({ m }: { m: Model }): JSX.Element {
  return (
    <div className="pc-sr-only" role="status" aria-live="polite">
      {m.announcement}
    </div>
  );
}

export const canWrite = (m: Model): boolean => !m.restriction && !m.recovery;

export function Notices({ m }: { m: Model }): JSX.Element | null {
  const dialog = useDialog();
  if (m.recovery) {
    return (
      <div className="pc-notice pc-notice--warn" role="alert" id="pc-recovery">
        <div>
          <strong>Comment changes on this task are paused.</strong> An earlier comment save was
          interrupted and needs a review before anything else is written here. History stays
          readable; your drafts are kept.
        </div>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() =>
            void dialog.confirm({
              title: 'Review recovery (stub)',
              message: 'Opens the recovery review panel — prototyped in #61.',
              confirmLabel: 'OK',
              cancelLabel: '',
            })
          }
        >
          Review recovery
        </button>
      </div>
    );
  }
  if (m.restriction === 'archived') {
    return (
      <div className="pc-notice" role="note">
        <div>
          <strong>This task is archived.</strong> You can read its comments. Restore the task to
          add, edit or delete comments.
        </div>
        <button type="button" className="btn btn--sm" onClick={() => alert('Restore (stub)')}>
          Restore task
        </button>
      </div>
    );
  }
  if (m.restriction === 'readonly') {
    return (
      <div className="pc-notice" role="note">
        <div>
          <strong>This project is read-only.</strong> Comments can be read here but not added,
          edited or deleted. Turn off read-only in the project switcher to change them.
        </div>
      </div>
    );
  }
  return null;
}

function onSubmitKeys(e: React.KeyboardEvent, submit: () => void, cancel: () => void): void {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    submit();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancel();
  }
}

export function Composer({
  m,
  compact = false,
}: {
  m: Model;
  compact?: boolean;
}): JSX.Element | null {
  const dialog = useDialog();
  const c = m.composer;
  if (!canWrite(m) && !c.draft) return null;
  const saving = c.phase === 'saving';
  const blocked = !canWrite(m);
  const cancel = (): void => {
    if (!c.draft.trim()) return m.cancelComposer();
    void dialog
      .confirm({
        title: 'Discard comment?',
        message: 'Your unsaved comment will be lost.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep writing',
        danger: true,
      })
      .then((ok) => (ok ? m.cancelComposer() : m.focus('composer-input')));
  };
  return (
    <form
      className={'pc-composer' + (compact ? ' pc-composer--compact' : '')}
      aria-label="New comment"
      aria-busy={saving}
      onSubmit={(e) => {
        e.preventDefault();
        m.post();
      }}
    >
      {c.restoredNotice && (
        <p className="pc-hint pc-hint--info">
          Restored your unsaved comment from when you left this task.
        </p>
      )}
      <label htmlFor="composer-input" className="pc-sr-only">
        Comment (Markdown)
      </label>
      <textarea
        id="composer-input"
        className="pc-textarea"
        rows={compact ? 4 : 7}
        placeholder="Write a comment… Markdown supported."
        value={c.draft}
        readOnly={saving || blocked}
        aria-describedby="composer-hint composer-error"
        aria-invalid={c.phase === 'failed' || c.phase === 'conflict'}
        onChange={(e) => m.setDraft(e.target.value)}
        onKeyDown={(e) => onSubmitKeys(e, m.post, cancel)}
      />
      <div className="pc-composer-row">
        <span id="composer-hint" className="pc-hint">
          {blocked
            ? 'Posting is paused while recovery is pending. Your text is kept.'
            : 'Ctrl+Enter to post · Esc to cancel'}
        </span>
        <button type="button" className="btn btn--sm btn--ghost" onClick={cancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn--sm pc-primary"
          disabled={saving || blocked || !c.draft.trim()}
          aria-disabled={saving}
        >
          {saving ? 'Posting…' : c.phase === 'failed' ? 'Retry' : 'Post comment'}
        </button>
      </div>
      <div id="composer-error" role={c.error ? 'alert' : undefined}>
        {c.error && (
          <div className="pc-error">
            {c.error}
            {c.phase === 'conflict' && (
              <button type="button" className="btn btn--sm" onClick={() => m.setDraft(c.draft)}>
                Reload task
              </button>
            )}
          </div>
        )}
      </div>
      <p className="pc-proto-note">
        key {c.opKey} · {c.phase}
      </p>
    </form>
  );
}

export function CommentBlock({
  m,
  c,
  deleteStyle,
  flat = false,
}: {
  m: Model;
  c: Comment;
  deleteStyle: 'inline' | 'dialog';
  flat?: boolean;
}): JSX.Element {
  const dialog = useDialog();
  const e = m.edit?.id === c.id ? m.edit : null;
  const writable = canWrite(m);
  const confirming = m.confirmDeleteId === c.id;
  const index = m.comments.findIndex((x) => x.id === c.id) + 1;

  const askDelete = (): void => {
    if (deleteStyle === 'inline') return m.askDelete(c.id);
    void dialog
      .confirm({
        title: 'Delete comment',
        message: 'Delete this comment? The Markdown file is removed. This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      })
      .then((ok) => (ok ? m.confirmDelete(c.id) : m.focus(`c-${c.id}-delete`)));
  };
  const cancelEdit = (): void => {
    if (!e || e.draft === c.body) return m.cancelEdit();
    void dialog
      .confirm({
        title: 'Discard edit?',
        message: 'Your changes to this comment will be lost.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        danger: true,
      })
      .then((ok) => (ok ? m.cancelEdit() : m.focus(`c-${c.id}-input`)));
  };

  return (
    <article
      id={`c-${c.id}`}
      tabIndex={-1}
      className={
        'pc-comment' + (flat ? ' pc-comment--flat' : '') + (e ? ' pc-comment--editing' : '')
      }
      aria-labelledby={`c-${c.id}-h`}
    >
      <header className="pc-comment-head">
        <h3 id={`c-${c.id}-h`} className="pc-comment-title">
          <span className="pc-sr-only">
            Comment {index} of {m.comments.length},{' '}
          </span>
          <time dateTime={c.createdAt}>{fmtTime(c.createdAt)}</time>
        </h3>
        {c.editedAt && (
          <span className="pc-edited" title={`Edited ${fmtTime(c.editedAt)}`}>
            edited
          </span>
        )}
        {writable && !e && !confirming && (
          <span className="pc-actions">
            <button
              id={`c-${c.id}-edit`}
              type="button"
              className="btn btn--sm btn--ghost"
              disabled={!!m.edit}
              onClick={() => m.startEdit(c.id)}
            >
              Edit
            </button>
            <button
              id={`c-${c.id}-delete`}
              type="button"
              className="btn btn--sm btn--ghost pc-danger-text"
              disabled={!!m.edit}
              onClick={askDelete}
            >
              Delete
            </button>
          </span>
        )}
      </header>

      {confirming && (
        <div className="pc-confirm" role="group" aria-label="Confirm delete">
          <span>Delete this comment? This cannot be undone.</span>
          <button
            id={`c-${c.id}-delete-cancel`}
            type="button"
            className="btn btn--sm"
            onClick={m.cancelDelete}
          >
            Keep
          </button>
          <button
            type="button"
            className="btn btn--sm btn--danger"
            onClick={() => m.confirmDelete(c.id)}
          >
            Delete
          </button>
        </div>
      )}

      {e ? <EditBox m={m} c={c} onCancel={cancelEdit} /> : <Markdown body={c.body} />}
    </article>
  );
}

function EditBox({ m, c, onCancel }: { m: Model; c: Comment; onCancel: () => void }): JSX.Element {
  const e = m.edit!;
  const saving = e.phase === 'saving';
  const textarea = (
    <textarea
      id={`c-${c.id}-input`}
      className="pc-textarea"
      rows={6}
      aria-label="Edit comment (Markdown)"
      value={e.draft}
      readOnly={saving}
      aria-describedby={`c-${c.id}-err`}
      onChange={(ev) => m.setEditDraft(ev.target.value)}
      onKeyDown={(ev) => onSubmitKeys(ev, m.saveEdit, onCancel)}
    />
  );
  if (e.phase === 'conflict' && e.current) {
    return (
      <div className="pc-conflict">
        <div className="pc-error" role="alert" id={`c-${c.id}-err`}>
          This comment was changed somewhere else after you started editing. Nothing was
          overwritten. Compare the versions, then choose.
        </div>
        <div className="pc-conflict-cols">
          <section aria-label="Current saved version">
            <h4 className="pc-col-h">Current saved version</h4>
            <Markdown body={e.current.body} />
          </section>
          <section aria-label="Your edit">
            <h4 className="pc-col-h">Your edit (not saved)</h4>
            {textarea}
          </section>
        </div>
        <div className="pc-composer-row">
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => void navigator.clipboard?.writeText(e.draft)}
          >
            Copy my edit
          </button>
          <button type="button" className="btn btn--sm btn--ghost" onClick={m.discardEdit}>
            Discard my edit
          </button>
          <button type="button" className="btn btn--sm pc-primary" onClick={m.rebaseEdit}>
            Continue editing on current version
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="pc-editbox" aria-busy={saving}>
      {textarea}
      <div className="pc-composer-row">
        <span className="pc-hint">Ctrl+Enter to save · Esc to cancel</span>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--sm pc-primary"
          onClick={m.saveEdit}
          disabled={saving || !e.draft.trim()}
        >
          {saving ? 'Saving…' : e.phase === 'failed' ? 'Retry save' : 'Save'}
        </button>
      </div>
      <div id={`c-${c.id}-err`} role={e.error ? 'alert' : undefined}>
        {e.error && <div className="pc-error">{e.error}</div>}
      </div>
    </div>
  );
}

export function LoadMore({ m }: { m: Model }): JSX.Element | null {
  if (m.remaining === 0) return null;
  const n = Math.min(m.remaining, 50);
  return (
    <div className="pc-loadmore">
      <span className="pc-hint">
        Showing {m.visible.length} of {m.comments.length}, oldest first
      </span>
      <button type="button" className="btn btn--sm" onClick={m.loadMore}>
        Load {n} newer comment{n === 1 ? '' : 's'}
      </button>
    </div>
  );
}

export function EmptyState({ m }: { m: Model }): JSX.Element {
  return (
    <div className="pc-empty">
      <p>No comments yet.</p>
      <p className="pc-hint">
        Use comments to record progress, decisions and findings on this task.
      </p>
      {canWrite(m) && !m.composer.open && (
        <button id="add-comment" type="button" className="btn pc-primary" onClick={m.openComposer}>
          Add comment
        </button>
      )}
    </div>
  );
}
