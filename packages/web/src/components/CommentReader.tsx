import type { KeyboardEvent } from 'react';
import type { Comment } from '@backlogger/shared';
import { CommentMarkdown, CommentMeta, isSubmitKey, submitLabel } from './CommentBody.js';
import { Icon } from './Icon.js';

/** An open edit of one comment, kept in the reader until saved or discarded. */
export interface EditDraft {
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

/** True when closing the edit would lose something the user typed or has yet to resolve. */
export function isEditDirty(edit: EditDraft): boolean {
  return edit.text !== edit.baseBody || edit.conflict !== null;
}

interface CommentReaderProps {
  /** The open comment; `null` once it is gone from the history. */
  comment: Comment | null;
  /** The open edit of this comment, if any. */
  edit: EditDraft | null;
  writable: boolean;
  /** Another comment is being edited: Edit and Delete wait for it. */
  locked: boolean;
  confirmingDelete: boolean;
  deleting: boolean;
  deleteError: string | null;
  onKeyDown: (e: KeyboardEvent) => void;
  onClose: () => void;
  onStartEdit: () => void;
  onEditText: (text: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onContinueOnCurrent: () => void;
  onCopyMyEdit: () => void;
  onDiscardMyEdit: () => void;
  onRequestDelete: () => void;
  onKeep: () => void;
  onConfirmDelete: () => void;
}

/**
 * The reader pane: one comment in full, where it is edited, deleted (with an
 * inline confirmation) and where an edit conflict is resolved.
 */
export function CommentReader(props: CommentReaderProps): JSX.Element {
  const { comment, onKeyDown, onClose } = props;
  return (
    <section
      className="comment-reader"
      role="region"
      aria-label="Comment reader"
      onKeyDown={onKeyDown}
    >
      <header className="comment-meta">
        {comment && <CommentMeta comment={comment} />}
        <button
          type="button"
          className="btn btn--sm btn--ghost comment-reader-close"
          aria-label="Close reader"
          title="Close reader"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      {!comment ? (
        <p className="comments-hint">This comment is no longer available.</p>
      ) : props.edit?.conflict ? (
        <EditConflict {...props} edit={props.edit} conflict={props.edit.conflict} />
      ) : props.edit ? (
        <EditForm {...props} edit={props.edit} />
      ) : (
        <ReadView {...props} comment={comment} />
      )}
    </section>
  );
}

function EditConflict({
  edit,
  conflict,
  onContinueOnCurrent,
  onCopyMyEdit,
  onDiscardMyEdit,
}: CommentReaderProps & { edit: EditDraft; conflict: Comment }): JSX.Element {
  return (
    <div className="comment-conflict">
      <p className="error">
        This comment changed since you started editing. Nothing was overwritten.
      </p>
      <h4>Saved version</h4>
      <CommentMarkdown body={conflict.body} className="comment-conflict-current" />
      <h4>Your edit</h4>
      <pre className="comment-conflict-mine">{edit.text}</pre>
      <div className="comment-actions">
        <button type="button" className="btn btn--sm comment-submit" onClick={onContinueOnCurrent}>
          Continue editing on current version
        </button>
        <button type="button" className="btn btn--sm" onClick={onCopyMyEdit}>
          Copy my edit
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onDiscardMyEdit}>
          Discard my edit
        </button>
      </div>
    </div>
  );
}

function EditForm({
  edit,
  onEditText,
  onSaveEdit,
  onCancelEdit,
}: CommentReaderProps & { edit: EditDraft }): JSX.Element {
  return (
    <form
      className="comment-edit"
      onSubmit={(e) => {
        e.preventDefault();
        onSaveEdit();
      }}
    >
      <textarea
        aria-label="Edit comment"
        data-focus="editor"
        value={edit.text}
        readOnly={edit.saving}
        onChange={(e) => onEditText(e.target.value)}
        onKeyDown={(e) => {
          if (!isSubmitKey(e)) return;
          e.preventDefault();
          onSaveEdit();
        }}
      />
      {edit.error && <p className="error">{edit.error}</p>}
      <div className="comment-actions">
        <button type="submit" className="btn btn--sm comment-submit" disabled={edit.saving}>
          {submitLabel(
            edit.saving ? 'Saving…' : null,
            edit.error !== null && edit.attempt?.body === edit.text,
            'Save changes',
          )}
        </button>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={edit.saving}
          onClick={onCancelEdit}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function ReadView({
  comment,
  writable,
  locked,
  confirmingDelete,
  deleting,
  deleteError,
  onStartEdit,
  onRequestDelete,
  onKeep,
  onConfirmDelete,
}: CommentReaderProps & { comment: Comment }): JSX.Element {
  return (
    <>
      <CommentMarkdown
        key={comment.id}
        body={comment.body}
        data-testid="reader-comment"
        tabIndex={-1}
      />
      {deleteError && <p className="error">{deleteError}</p>}
      {writable &&
        (confirmingDelete ? (
          <div className="comment-delete-confirm" role="group" aria-label="Confirm delete">
            <span>Delete this comment? This cannot be undone.</span>
            <button type="button" className="btn btn--sm" data-focus="keep" onClick={onKeep}>
              Keep
            </button>
            <button
              type="button"
              className="btn btn--sm btn--danger"
              disabled={deleting}
              onClick={onConfirmDelete}
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
              disabled={locked}
              onClick={onStartEdit}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              data-focus="delete"
              disabled={locked}
              onClick={onRequestDelete}
            >
              Delete
            </button>
          </div>
        ))}
    </>
  );
}
