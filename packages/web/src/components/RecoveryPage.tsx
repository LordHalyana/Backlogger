import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Project, RecoveryDetail, RecoveryPath, RecoverySummary } from '@backlogger/shared';
import { ApiError } from '../lib/api.js';
import { newUuid } from '../lib/comments.js';
import {
  attempted,
  formatStarted,
  headline,
  isCommentOperation,
  isContentConflict,
  isDeletion,
  isMoving,
  isTransfer,
  kindLabel,
  needsReview,
  routeLabel,
  taskName,
  useAbandon,
  useRecheck,
  useRecoveryDetail,
  useRecoveryList,
  type ProjectNamer,
} from '../lib/recovery.js';
import { StatusMessage } from './StatusMessage.js';

interface RecoveryPageProps {
  /** The operation shown on the right, from `/recovery/:operationId`. */
  operationId: string | null;
  projects: readonly Project[];
  /** Select another operation (↑/↓ or a click in the list). */
  onSelect: (operationId: string) => void;
  onOpenTask: (projectId: string, taskId: string) => void;
}

/** A notice in the review panel: a recheck's result, or a stale review. */
interface PanelNotice {
  operationId: string;
  kind: 'info' | 'error' | 'ok';
  text: string;
  detail?: string;
}

/**
 * The Recovery page (spec #58, #61 variant B): every pending operation, and
 * abandoned ones until dismissed, listed on the left; the selected one's
 * review on the right. Recheck resumes the original operation; comment
 * operations may also be abandoned, keeping the current file. There is no
 * merge editor.
 */
export function RecoveryPage({
  operationId,
  projects,
  onSelect,
  onOpenTask,
}: RecoveryPageProps): JSX.Element {
  const list = useRecoveryList();
  const detail = useRecoveryDetail(operationId);
  const recheck = useRecheck();
  const abandon = useAbandon();
  const operations = list.data?.operations ?? [];
  const projectName = useCallback<ProjectNamer>(
    (id) => projects.find((p) => p.id === id)?.name ?? id ?? 'an unknown project',
    [projects],
  );

  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<PanelNotice | null>(null);
  // Each message renders as a new node, so a repeated message is announced again.
  const [announcement, setAnnouncementState] = useState({ text: '', seq: 0 });
  const announce = useCallback(
    (text: string) => setAnnouncementState((cur) => ({ text, seq: cur.seq + 1 })),
    [],
  );

  // Focus moves land once their target has rendered.
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Opening the page focuses its heading.
  const pendingFocus = useRef<string | null>('page-heading');
  const [, setFocusRequest] = useState(0);
  const focusSoon = useCallback((name: string) => {
    pendingFocus.current = name;
    setFocusRequest((n) => n + 1);
  }, []);
  useEffect(() => {
    const name = pendingFocus.current;
    if (!name) return;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-focus="${name}"]`);
    if (!el) return;
    el.focus();
    pendingFocus.current = null;
  });

  // A new selection starts a new review.
  useEffect(() => {
    setConfirming(false);
    setNotice((cur) => (cur?.operationId === operationId ? cur : null));
  }, [operationId]);

  const optionRefs = useRef(new Map<string, HTMLElement>());
  const onListKeyDown = (e: KeyboardEvent, index: number): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const next = operations[index + (e.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    onSelect(next.operation_id);
    optionRefs.current.get(next.operation_id)?.focus();
  };

  const summary =
    operations.find((op) => op.operation_id === operationId) ??
    (detail.data && detail.data.operation_id === operationId ? detail.data : undefined);

  const runRecheck = (op: RecoverySummary): void => {
    if (recheck.isPending) return;
    setNotice(null);
    recheck.mutate(op.operation_id, {
      onSuccess: (result) => {
        if (result.state === 'completed') {
          const text = finishedText(op, projectName);
          setNotice({
            operationId: op.operation_id,
            kind: 'ok',
            text,
            detail: 'Recheck finished the original operation.',
          });
          announce(text);
          focusSoon('notice');
        } else if (result.state === 'pending') {
          const content = !!result.recovery && isContentConflict(result.recovery);
          setNotice({
            operationId: op.operation_id,
            kind: 'info',
            text: content
              ? 'Rechecked. The file is still different from both known versions, so nothing was applied.'
              : 'Rechecked. The operation is still stopped. Follow the repair steps first.',
          });
          announce(content ? 'Still needs review.' : 'Still stopped. Follow the repair steps.');
        } else {
          void detail.refetch();
        }
      },
      onError: (err) => {
        setNotice({
          operationId: op.operation_id,
          kind: 'error',
          text: `Recheck failed: ${errorMessage(err)}`,
        });
        announce('Recheck failed.');
      },
    });
  };

  // A retry of the same review reuses its key; a new review (new token) gets a new one.
  const abandonKey = useRef<{ review: string; key: string } | null>(null);
  const runAbandon = (review: RecoveryDetail): void => {
    if (abandon.isPending) return;
    const scope = `${review.operation_id}:${review.review_token}`;
    if (abandonKey.current?.review !== scope) {
      abandonKey.current = { review: scope, key: newUuid() };
    }
    abandon.mutate(
      {
        operationId: review.operation_id,
        key: abandonKey.current.key,
        reviewToken: review.review_token,
      },
      {
        onSuccess: () => {
          setConfirming(false);
          setNotice(null);
          announce('Pending change abandoned. Current file kept.');
          void detail.refetch().then(() => focusSoon('final'));
        },
        onError: (err) => {
          setConfirming(false);
          if (err instanceof ApiError && err.code === 'REVISION_CONFLICT') {
            setNotice({
              operationId: review.operation_id,
              kind: 'error',
              text: 'The file changed since you opened this review. Review the new current file, then choose again.',
            });
            announce('Not abandoned. The file changed since you opened this review.');
            void detail.refetch();
          } else {
            setNotice({
              operationId: review.operation_id,
              kind: 'error',
              text: `Not abandoned: ${errorMessage(err)}`,
            });
            announce('Not abandoned.');
          }
          focusSoon('notice');
        },
      },
    );
  };

  const needing = operations.filter(needsReview).length;
  const running = operations.filter((op) => op.state === 'pending' && op.in_progress).length;
  const tabStop = operations.some((op) => op.operation_id === operationId)
    ? operationId
    : (operations[0]?.operation_id ?? null);

  return (
    <div className="recovery-page" ref={rootRef}>
      <div className="recovery-head">
        <h2 tabIndex={-1} data-focus="page-heading">
          Recovery
        </h2>
        {list.data && (
          <span className="recovery-muted">
            {needing} need review · {running} in progress
          </span>
        )}
      </div>
      <div className="recovery-body">
        <div className="recovery-list" role="listbox" aria-label="Operations">
          {list.isLoading && <StatusMessage kind="loading">Loading…</StatusMessage>}
          {list.isError && (
            <StatusMessage kind="error">
              Failed to load recovery: {errorMessage(list.error)}
            </StatusMessage>
          )}
          {list.data && operations.length === 0 && (
            <p className="recovery-muted">Nothing needs recovery.</p>
          )}
          {operations.map((op, i) => (
            <div
              key={op.operation_id}
              ref={(el) => {
                if (el) optionRefs.current.set(op.operation_id, el);
                else optionRefs.current.delete(op.operation_id);
              }}
              role="option"
              aria-selected={op.operation_id === operationId}
              tabIndex={op.operation_id === tabStop ? 0 : -1}
              className={
                'recovery-option' + (op.operation_id === operationId ? ' is-selected' : '')
              }
              onClick={() => onSelect(op.operation_id)}
              onKeyDown={(e) => onListKeyDown(e, i)}
            >
              <span className="recovery-option-line">
                <strong>{taskName(op)}</strong>
                <StatusBadge op={op} />
              </span>
              <span className="recovery-muted">
                {routeLabel(op, projectName)} · {formatStarted(op.created_at)}
              </span>
            </div>
          ))}
        </div>
        <section className="recovery-detail" aria-label="Review">
          {operationId === null ? (
            <p className="recovery-muted">Select an operation.</p>
          ) : notice?.kind === 'ok' && notice.operationId === operationId ? (
            <>
              {summary && <PanelHeading op={summary} projectName={projectName} />}
              <div className="recovery-notice is-ok" tabIndex={-1} data-focus="notice">
                <p>
                  <strong>{notice.text}</strong> {notice.detail}
                </p>
              </div>
            </>
          ) : detail.isError ? (
            <StatusMessage kind="error">
              {detail.error instanceof ApiError && detail.error.status === 404
                ? 'This operation is no longer pending. Nothing needs doing.'
                : `Failed to load the review: ${errorMessage(detail.error)}`}
            </StatusMessage>
          ) : !detail.data ? (
            <StatusMessage kind="loading">Loading…</StatusMessage>
          ) : (
            <ReviewPanel
              review={detail.data}
              projectName={projectName}
              notice={notice?.operationId === operationId ? notice : null}
              confirming={confirming}
              busy={recheck.isPending || abandon.isPending}
              onOpenTask={onOpenTask}
              onRecheck={() => runRecheck(detail.data)}
              onRequestAbandon={() => {
                setConfirming(true);
                focusSoon('keep-reviewing');
              }}
              onKeepReviewing={() => {
                setConfirming(false);
                focusSoon('abandon');
              }}
              onAbandon={() => runAbandon(detail.data)}
              onCopied={announce}
            />
          )}
        </section>
      </div>
      <div className="visually-hidden" aria-live="polite" data-testid="recovery-live">
        <span key={announcement.seq}>{announcement.text}</span>
      </div>
    </div>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** What a finished recheck says, and announces. */
function finishedText(op: RecoverySummary, projectName: ProjectNamer): string {
  if (isTransfer(op)) return `Filed to ${projectName(op.target_project_id)}.`;
  if (isDeletion(op)) return 'Deleted permanently.';
  if (op.command === 'comment.delete') return 'Comment deleted.';
  return op.command === 'comment.create' ? 'Comment posted.' : 'Comment saved.';
}

function StatusBadge({ op }: { op: RecoverySummary }): JSX.Element {
  if (op.state === 'abandoned') {
    return <span className="recovery-badge is-muted">Abandoned</span>;
  }
  if (isMoving(op)) return <span className="recovery-badge is-moving">Moving…</span>;
  if (op.in_progress) return <span className="recovery-badge is-moving">In progress</span>;
  return (
    <span className={'recovery-badge' + (isDeletion(op) ? ' is-danger' : '')}>{kindLabel(op)}</span>
  );
}

function PanelHeading({
  op,
  projectName,
  onOpenTask,
}: {
  op: RecoverySummary;
  projectName: ProjectNamer;
  onOpenTask?: (projectId: string, taskId: string) => void;
}): JSX.Element {
  // A task hidden by a pending deletion cannot be opened.
  const canOpen = !isDeletion(op) && op.project_id !== null && op.task_id !== null;
  return (
    <div className="recovery-detail-head">
      <h2 tabIndex={-1} data-focus="panel-heading">
        {headline(op, projectName)}
      </h2>
      <StatusBadge op={op} />
      <span className="topbar-spacer" />
      {onOpenTask && canOpen && (
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => onOpenTask(op.project_id!, op.task_id!)}
        >
          Open task
        </button>
      )}
    </div>
  );
}

interface ReviewPanelProps {
  review: RecoveryDetail;
  projectName: ProjectNamer;
  notice: PanelNotice | null;
  confirming: boolean;
  busy: boolean;
  onOpenTask: (projectId: string, taskId: string) => void;
  onRecheck: () => void;
  onRequestAbandon: () => void;
  onKeepReviewing: () => void;
  onAbandon: () => void;
  onCopied: (message: string) => void;
}

function ReviewPanel({
  review,
  projectName,
  notice,
  confirming,
  busy,
  onOpenTask,
  onRecheck,
  onRequestAbandon,
  onKeepReviewing,
  onAbandon,
  onCopied,
}: ReviewPanelProps): JSX.Element {
  const heading = <PanelHeading op={review} projectName={projectName} onOpenTask={onOpenTask} />;
  if (review.state === 'abandoned') {
    return (
      <>
        {heading}
        <AbandonedState review={review} />
      </>
    );
  }
  const content =
    isContentConflict(review) &&
    (review.pending_content !== null || review.current_content !== null);
  const abandonable = review.actions.includes('abandon');
  return (
    <>
      {heading}
      <p className="recovery-reason">{review.message}</p>
      {notice && (
        <div
          className={`recovery-notice is-${notice.kind}`}
          tabIndex={-1}
          data-focus="notice"
          role={notice.kind === 'error' ? 'alert' : undefined}
        >
          <p>{notice.text}</p>
        </div>
      )}
      <Facts review={review} projectName={projectName} />
      {review.in_progress ? (
        <div className="recovery-progress">
          <p>{progressLine(review)}</p>
          <p className="recovery-muted">
            This finishes on its own; if it stops, it shows here as needing review.
          </p>
        </div>
      ) : (
        <>
          {content ? (
            <Versions review={review} onCopied={onCopied} />
          ) : (
            <>
              <PathTable paths={review.paths} />
              <RepairSteps review={review} abandonable={abandonable} />
            </>
          )}
          {confirming ? (
            <div
              className="recovery-confirm"
              role="group"
              aria-labelledby="recovery-confirm-title"
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                e.preventDefault();
                e.stopPropagation();
                onKeepReviewing();
              }}
            >
              <strong id="recovery-confirm-title">
                Keep the current file and abandon your edit?
              </strong>
              <span>
                Your pending text is discarded. Copy or download it first if you want to keep it.
                This cannot be undone.
              </span>
              <div className="recovery-actions">
                <button
                  type="button"
                  className="btn btn--sm"
                  data-focus="keep-reviewing"
                  onClick={onKeepReviewing}
                >
                  Keep reviewing
                </button>
                <button
                  type="button"
                  className="btn btn--sm btn--danger-solid"
                  disabled={busy}
                  onClick={onAbandon}
                >
                  Abandon pending change
                </button>
              </div>
            </div>
          ) : (
            <div className="recovery-actions">
              {review.actions.includes('recheck') && (
                <button
                  type="button"
                  className="btn btn--sm btn--primary"
                  disabled={busy}
                  onClick={onRecheck}
                >
                  {busy ? 'Working…' : 'Recheck'}
                </button>
              )}
              {abandonable && (
                <button
                  type="button"
                  className="btn btn--sm btn--danger"
                  data-focus="abandon"
                  disabled={busy}
                  onClick={onRequestAbandon}
                >
                  Keep current file and abandon pending change…
                </button>
              )}
              <span className="recovery-muted">
                Recheck resumes the original operation. It never overwrites a file that changed.
              </span>
            </div>
          )}
        </>
      )}
    </>
  );
}

function Facts({
  review,
  projectName,
}: {
  review: RecoveryDetail;
  projectName: ProjectNamer;
}): JSX.Element {
  const file = isCommentOperation(review) ? review.paths[0]?.path : undefined;
  return (
    <dl className="recovery-facts">
      <dt>Attempted</dt>
      <dd>{attempted(review, projectName)}</dd>
      <dt>Started</dt>
      <dd>{formatStarted(review.created_at)}</dd>
      {file && (
        <>
          <dt>File</dt>
          <dd>
            <code>{file}</code>
          </dd>
        </>
      )}
      <dt>Operation ID</dt>
      <dd>
        <code>{review.operation_id}</code>
      </dd>
    </dl>
  );
}

/** How far a running operation got, from the files it has written so far. */
function progressLine(review: RecoveryDetail): string {
  if (!isTransfer(review)) return 'Still running. No action needed.';
  const copies = review.paths.filter(
    (p) => p.before_revision === null && p.after_revision !== null,
  );
  const done = copies.filter((p) => p.observed_revision === p.after_revision).length;
  return `Copying ${done} of ${copies.length} files. No action needed.`;
}

/** Lines of `text` that `other` lacks: the changed lines to tint. */
function markedLines(text: string, other: string | null): { line: string; changed: boolean }[] {
  const theirs = new Set((other ?? '').split('\n'));
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.map((line) => ({ line, changed: !theirs.has(line) }));
}

function Version({
  label,
  hint,
  text,
  other,
  empty,
  children,
}: {
  label: string;
  hint: string;
  text: string | null;
  other: string | null;
  empty: string;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <section className="recovery-version" aria-label={label}>
      <header className="recovery-version-head">
        <span>{label}</span>
        <span className="recovery-muted">{hint}</span>
        {children}
      </header>
      {text === null ? (
        <p className="recovery-muted recovery-version-empty">{empty}</p>
      ) : (
        <pre>
          {markedLines(text, other).map(({ line, changed }, i) => (
            <span key={i} className={'recovery-line' + (changed ? ' is-changed' : '')}>
              {line === '' ? ' ' : line}
            </span>
          ))}
        </pre>
      )}
    </section>
  );
}

function Versions({
  review,
  onCopied,
}: {
  review: RecoveryDetail;
  onCopied: (message: string) => void;
}): JSX.Element {
  const pending = review.pending_content;
  const copy = (): void => {
    if (pending === null) return;
    void navigator.clipboard
      ?.writeText(pending)
      .then(() => onCopied('Pending change copied.'))
      .catch(() => onCopied('Copy failed. Select the text to copy it.'));
  };
  return (
    <div className="recovery-versions">
      <Version
        label="Current file"
        hint="on disk now"
        text={review.current_content}
        other={pending}
        empty="The file is missing. Backlogger never recreates it."
      />
      <Version
        label="Pending change (your edit, not saved)"
        hint=""
        text={pending}
        other={review.current_content}
        empty="Delete this comment."
      >
        {pending === null ? undefined : (
          <span className="recovery-version-actions">
            <button type="button" className="btn btn--sm btn--ghost" onClick={copy}>
              Copy
            </button>
            <a
              className="btn btn--sm btn--ghost"
              href={`data:text/markdown;charset=utf-8,${encodeURIComponent(pending)}`}
              download={`pending-${review.comment_id ?? review.operation_id}.md`}
            >
              Download .md
            </a>
          </span>
        )}
      </Version>
    </div>
  );
}

/** A file is a problem when it is in neither the known before nor the known after state. */
function isProblem(p: RecoveryPath): boolean {
  return p.observed_revision !== p.before_revision && p.observed_revision !== p.after_revision;
}

function expected(p: RecoveryPath): string {
  if (p.before_revision === null && p.after_revision === null) return 'Not part of the operation';
  if (p.before_revision === null) return 'Absent, then written';
  if (p.after_revision === null) return 'Present, then removed';
  return 'Present, then updated';
}

function found(p: RecoveryPath): string {
  if (p.observed_revision === null) return 'Absent';
  if (p.observed_revision === p.after_revision) return 'Matches the finished state';
  if (p.observed_revision === p.before_revision) return 'Matches the starting state';
  return 'A different file';
}

function PathTable({ paths }: { paths: readonly RecoveryPath[] }): JSX.Element | null {
  if (paths.length === 0) return null;
  return (
    <div className="recovery-table-wrap">
      <table className="recovery-paths">
        <thead>
          <tr>
            <th>Path</th>
            <th>Expected</th>
            <th>Found</th>
          </tr>
        </thead>
        <tbody>
          {paths.map((p) => (
            <tr key={p.path} className={isProblem(p) ? 'is-problem' : undefined}>
              <td>
                <code>{p.path}</code>
              </td>
              <td>{expected(p)}</td>
              <td>{isProblem(p) ? <strong>{found(p)}</strong> : found(p)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The documented manual repair: stop, back up, repair the listed paths, restart, Recheck. */
function repairSteps(review: RecoveryDetail): string[] {
  if (review.kind === 'resumable') return ['Nothing needs repairing.', 'Choose Recheck.'];
  const problems = review.paths.filter(isProblem);
  const fixes = problems.map((p) =>
    p.observed_revision === null
      ? `Put ${p.path} back from your copy or backup.`
      : `Move ${p.path} out of the project folder. Keep it somewhere else if you need it; Backlogger will not delete it for you.`,
  );
  return [
    'Stop Backlogger and copy the whole data directory somewhere safe.',
    ...(fixes.length > 0 ? fixes : ['Repair what the reason above describes.']),
    'Start Backlogger again and open this review. Never edit its operational records by hand.',
    'Choose Recheck.',
  ];
}

function RepairSteps({
  review,
  abandonable,
}: {
  review: RecoveryDetail;
  abandonable: boolean;
}): JSX.Element {
  return (
    <section className="recovery-repair">
      <h3 id={`repair-${review.operation_id}`}>To repair</h3>
      <ol aria-labelledby={`repair-${review.operation_id}`}>
        {repairSteps(review).map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {!abandonable && (
        <p className="recovery-muted">
          This operation cannot be abandoned. Backlogger only moves it forward after you repair the
          files.
        </p>
      )}
    </section>
  );
}

function AbandonedState({ review }: { review: RecoveryDetail }): JSX.Element {
  return (
    <div className="recovery-final" tabIndex={-1} data-focus="final">
      <h3>Pending change abandoned</h3>
      <p>
        The current file was kept unchanged. Your edit was discarded and cannot be recovered from
        Backlogger. Comment writes on {taskName(review)} are available again.
      </p>
      <p className="recovery-muted">
        Abandoned {review.abandoned_at ? formatStarted(review.abandoned_at) : ''} · operation{' '}
        <code>{review.operation_id.slice(0, 8)}…</code> · Retrying the original edit returns this
        result.
      </p>
    </div>
  );
}
