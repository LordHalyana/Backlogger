import { createPortal } from 'react-dom';
import type { Document, Project } from '@backlogger/shared';
import { useCapture } from '../lib/capture.js';
import { acceptsBacklogItems, orderProjects } from '../lib/inbox.js';
import { CaptureForm } from './CaptureForm.js';

interface CapturePaletteProps {
  projects: readonly Project[];
  onClose: () => void;
  onOpenTask: (doc: Document) => void;
}

/**
 * The global capture palette (bare `n`). The destination defaults to the
 * Inbox; it stays open after each capture so the next task can be typed
 * straight away. Esc closes it and creates nothing.
 */
export function CapturePalette({
  projects,
  onClose,
  onOpenTask,
}: CapturePaletteProps): JSX.Element {
  const capture = useCapture(null);
  const destinations = orderProjects(projects).filter((p) => !p.isInbox && acceptsBacklogItems(p));
  const inboxAvailable = projects.some((p) => p.isInbox);

  return createPortal(
    <div
      className="command-palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="command-palette capture-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Capture"
      >
        <CaptureForm
          capture={capture}
          destinations={destinations}
          inboxAvailable={inboxAvailable}
          projects={projects}
          autoFocus
          onOpenTask={onOpenTask}
          onCancel={onClose}
        />
        <div className="command-palette-footer">
          <kbd>Enter</kbd> add &middot; <kbd>Esc</kbd> close &middot; stays open for the next task
        </div>
      </div>
    </div>,
    document.body,
  );
}
