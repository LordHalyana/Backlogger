import { taskStateColumn, type Board } from '@backlogger/shared';
import type { DocumentsRepo } from '../db/documents-repo.js';
import type { ProjectsRepo } from '../db/projects-repo.js';
import { NotFoundError } from '../errors.js';

export interface BoardServiceDeps {
  documentsRepo: DocumentsRepo;
  projectsRepo: ProjectsRepo;
}

/**
 * The project board: every non-archived backlog item, drafts included, in the
 * column of its task state. Each column is in creation order (`created_at`,
 * then id); nothing about order is persisted. Sidecar-mode projects are not
 * on the board in the first version.
 */
export class BoardService {
  constructor(private readonly deps: BoardServiceDeps) {}

  board(projectId: string): Board {
    const project = this.deps.projectsRepo.find(projectId);
    if (!project) throw new NotFoundError('PROJECT_NOT_FOUND', `Project not found: ${projectId}`);

    const board: Board = { columns: { todo: [], in_progress: [], done: [] } };
    if (project.metadataMode === 'sidecar') return board;

    for (const item of this.deps.documentsRepo.listBoardItems(projectId)) {
      board.columns[taskStateColumn(item.task_state)].push({
        id: item.id,
        title: item.title,
        tags: item.tags,
        status: item.status,
        readOnly: project.readOnly || item.readOnly,
        revision: item.revision,
        task_state: item.task_state,
        created_at: item.created_at,
      });
    }
    return board;
  }
}
