import type { Project } from '@backlogger/shared';
import { orderProjects } from '../lib/inbox.js';
import { ProjectName } from './ProjectName.js';

interface WorkspaceRailProps {
  projects: readonly Project[];
  /** Items waiting in the Inbox; `null` while unknown. */
  inboxCount: number | null;
  triageOpen: boolean;
  selectedProjectId: string | null;
  onCapture: () => void;
  onOpenTriage: () => void;
  onSelectProject: (projectId: string) => void;
}

/**
 * Left rail: Capture, the ⌂ Inbox (into triage) and the native projects (to
 * their boards). At narrow widths it is hidden and the project switcher
 * carries the same entries.
 */
export function WorkspaceRail({
  projects,
  inboxCount,
  triageOpen,
  selectedProjectId,
  onCapture,
  onOpenTriage,
  onSelectProject,
}: WorkspaceRailProps): JSX.Element {
  const inbox = projects.find((p) => p.isInbox);
  return (
    <nav className="workspace-rail" aria-label="Workspace">
      <button
        type="button"
        className="btn workspace-rail-capture"
        onClick={onCapture}
        title="Capture (n)"
      >
        + Capture <kbd>n</kbd>
      </button>
      <button
        type="button"
        className={`workspace-rail-item${triageOpen ? ' active' : ''}`}
        onClick={onOpenTriage}
        aria-current={triageOpen ? 'page' : undefined}
        disabled={!inbox}
        title={inbox ? 'Inbox triage' : 'The Inbox is unavailable'}
      >
        <span className="inbox-mark" aria-hidden="true">
          ⌂
        </span>
        {inbox?.name ?? 'Inbox'}
        {inboxCount !== null && (
          <span className="workspace-rail-count" aria-label={`${inboxCount} in Inbox`}>
            {inboxCount}
          </span>
        )}
      </button>
      <div className="workspace-rail-label">Projects</div>
      {orderProjects(projects)
        .filter((p) => !p.isInbox)
        .map((p) => {
          const active = !triageOpen && selectedProjectId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              className={`workspace-rail-item${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelectProject(p.id)}
            >
              <ProjectName project={p} />
            </button>
          );
        })}
    </nav>
  );
}
