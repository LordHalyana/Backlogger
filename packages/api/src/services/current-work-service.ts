import type { CurrentWork } from '@backlogger/shared';
import type { DocumentsRepo } from '../db/documents-repo.js';
import type { ProjectsRepo } from '../db/projects-repo.js';
import { toBoardCard } from './board-service.js';
import type { InboxService } from './inbox-service.js';

export interface CurrentWorkServiceDeps {
  documentsRepo: DocumentsRepo;
  projectsRepo: ProjectsRepo;
  inbox: InboxService;
}

/**
 * Current work: the In progress backlog items of every native project,
 * derived from task state alone and following the board's rules (drafts in,
 * archived out, sidecar-mode projects not shown). Nothing is stored for it.
 */
export class CurrentWorkService {
  constructor(private readonly deps: CurrentWorkServiceDeps) {}

  read(): CurrentWork {
    const projects = new Map(this.deps.projectsRepo.list().map((p) => [p.id, p] as const));
    const groups = new Map<string, CurrentWork['groups'][number]>();
    for (const item of this.deps.documentsRepo.listInProgressItems()) {
      const project = projects.get(item.project_id);
      if (!project || project.metadataMode === 'sidecar') continue;
      let group = groups.get(project.id);
      if (!group) {
        group = {
          project: {
            id: project.id,
            name: project.name,
            readOnly: project.readOnly,
            isInbox: this.deps.inbox.isInbox(project.id),
          },
          items: [],
        };
        groups.set(project.id, group);
      }
      group.items.push(toBoardCard(item, project.readOnly));
    }
    const ordered = [...groups.values()].sort(
      (a, b) =>
        Number(b.project.isInbox) - Number(a.project.isInbox) ||
        a.project.name.localeCompare(b.project.name) ||
        a.project.id.localeCompare(b.project.id),
    );
    return { groups: ordered };
  }
}
