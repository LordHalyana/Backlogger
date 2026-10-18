import type { Project } from '@backlogger/shared';
import { Icon } from './Icon.js';

/**
 * A project's display name. The designated Inbox carries the ⌂ mark — the only
 * thing that tells it apart from a project that happens to be named "Inbox".
 */
export function ProjectName({
  project,
}: {
  project: Pick<Project, 'name' | 'isInbox' | 'readOnly'> | undefined;
}): JSX.Element {
  if (!project) return <span className="muted">(unknown project)</span>;
  return (
    <span className="project-name">
      {project.isInbox && (
        <span className="inbox-mark" title="Designated Inbox" aria-label="Designated Inbox">
          ⌂
        </span>
      )}
      {project.name}
      {project.readOnly && <Icon name="lock" className="project-name-lock" />}
    </span>
  );
}
