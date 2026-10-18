import { useEffect, useRef } from 'react';
import type { Document, Project } from '@backlogger/shared';
import type { Capture } from '../lib/capture.js';
import { ProjectName } from './ProjectName.js';

interface CaptureFormProps {
  capture: Capture;
  /**
   * Destination choices after the Inbox. Omit to hide the destination: the
   * board's inline Add task always captures into its own project.
   */
  destinations?: readonly Project[];
  /** Whether a designated Inbox exists to capture into. */
  inboxAvailable?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  /** Every project, to name the one a capture landed in. */
  projects: readonly Project[];
  onOpenTask: (doc: Document) => void;
  onCancel?: () => void;
  className?: string;
}

/**
 * Title-only capture: Enter adds. On success the field is cleared and focused
 * for the next task; on failure the text and destination stay and the button
 * becomes Retry, which resends the same capture.
 */
export function CaptureForm({
  capture,
  destinations,
  inboxAvailable = true,
  autoFocus,
  placeholder = 'Capture a task…',
  projects,
  onOpenTask,
  onCancel,
  className,
}: CaptureFormProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);

  // Ready for the next capture as soon as one succeeds.
  useEffect(() => {
    if (capture.created) inputRef.current?.focus();
  }, [capture.created]);

  const blank = !capture.title.trim();
  return (
    <form
      className={`capture-form${className ? ` ${className}` : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        void capture.submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && onCancel) {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="capture-form-row">
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          className="capture-form-input"
          aria-label="Task title"
          placeholder={placeholder}
          maxLength={200}
          value={capture.title}
          onChange={(e) => capture.setTitle(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        {destinations && (
          <select
            className="capture-form-destination"
            aria-label="Destination"
            value={capture.destination ?? ''}
            onChange={(e) => capture.setDestination(e.target.value || null)}
          >
            <option value="">{inboxAvailable ? '⌂ Inbox' : '⌂ Inbox (unavailable)'}</option>
            {destinations.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <button type="submit" className="btn" disabled={capture.pending || blank}>
          {capture.pending ? 'Saving…' : capture.error ? 'Retry' : 'Add'}
        </button>
      </div>
      <div className="capture-form-feedback" aria-live="polite">
        {capture.pending && <span className="muted">Saving “{capture.title.trim()}”…</span>}
        {!capture.pending && capture.error && (
          <span className="capture-form-error" role="alert">
            {capture.error} Your text is kept — press Enter to retry.
          </span>
        )}
        {!capture.pending && !capture.error && capture.created && (
          <span className="capture-form-ok">
            Added “{capture.created.title}” to{' '}
            <ProjectName project={projects.find((p) => p.id === capture.created!.project_id)} />.{' '}
            <button
              type="button"
              className="btn btn--link"
              onClick={() => onOpenTask(capture.created!)}
            >
              Open task
            </button>
          </span>
        )}
      </div>
    </form>
  );
}
