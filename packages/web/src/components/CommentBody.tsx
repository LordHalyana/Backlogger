import { useMemo } from 'react';
import type { KeyboardEvent } from 'react';
import { renderMarkdown, type Comment } from '@backlogger/shared';

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function isEdited(c: Comment): boolean {
  return c.updated_at !== c.created_at;
}

/** A comment's first non-blank line, for the one-line thread rows beside the reader. */
export function firstLine(body: string): string {
  return (
    body
      .split('\n')
      .find((l) => l.trim() !== '')
      ?.trim() ?? ''
  );
}

/**
 * A submit button's label: the busy label while it runs, Retry after a failure
 * when the same attempt would be resent, otherwise the idle label.
 */
export function submitLabel(busy: string | null, retry: boolean, idle: string): string {
  return busy ?? (retry ? 'Retry' : idle);
}

/** Ctrl/⌘+Enter: post or save. */
export function isSubmitKey(e: KeyboardEvent): boolean {
  return e.key === 'Enter' && (e.ctrlKey || e.metaKey);
}

/** When the comment was written, and the edited marker. */
export function CommentMeta({ comment }: { comment: Comment }): JSX.Element {
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

/** A comment body rendered as Markdown. */
export function CommentMarkdown({
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
