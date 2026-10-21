import type { KeyboardEvent } from 'react';
import { isSubmitKey, submitLabel } from './CommentBody.js';

/** Why the last post did not land. */
export interface ComposerError {
  /** `task-changed`: the task moved, was archived or went away while posting. */
  kind: 'failed' | 'task-changed';
  message: string;
}

interface CommentComposerProps {
  text: string;
  posting: boolean;
  error: ComposerError | null;
  /** The failed post would be resent unchanged (same Idempotency-Key): offer Retry. */
  canRetry: boolean;
  onText: (text: string) => void;
  onPost: () => void;
  /** Esc in the composer: leave it, asking first when there is text. */
  onEscape: () => void;
  onReloadTask: () => void;
}

/** The composer docked under the thread. Ctrl/⌘+Enter posts. */
export function CommentComposer({
  text,
  posting,
  error,
  canRetry,
  onText,
  onPost,
  onEscape,
  onReloadTask,
}: CommentComposerProps): JSX.Element {
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isSubmitKey(e)) {
      e.preventDefault();
      onPost();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!posting) onEscape();
    }
  };
  return (
    <form
      className="comments-composer"
      onSubmit={(e) => {
        e.preventDefault();
        onPost();
      }}
    >
      <textarea
        aria-label="New comment"
        data-focus="composer"
        placeholder="Add a comment (Markdown). Ctrl+Enter posts."
        value={text}
        readOnly={posting}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {error && (
        <div className="comments-composer-error">
          <span className="error">{error.message}</span>
          {error.kind === 'task-changed' && (
            <button type="button" className="btn btn--sm" onClick={onReloadTask}>
              Reload task
            </button>
          )}
        </div>
      )}
      <div className="comment-actions">
        <button
          type="submit"
          className="btn btn--sm comment-submit"
          disabled={posting || text.trim() === ''}
        >
          {submitLabel(posting ? 'Posting…' : null, canRetry, 'Post comment')}
        </button>
      </div>
    </form>
  );
}
