import type {
  CreateProjectRequest,
  DeleteProjectAck,
  Project,
  UpdateProjectRequest,
} from '@backlogger/shared';
import type { FsRepository } from '../fs/index.js';
import type { ProjectRecord, ProjectsRepo } from '../db/projects-repo.js';
import type { InboxService } from './inbox-service.js';
import { ConflictError, NotFoundError } from '../errors.js';
import {
  operationFingerprint,
  parseOperationId,
  recoveryRequired,
  type WriteCoordinator,
} from './write-coordinator.js';
import { DELETE_PROJECT_COMMAND, type PermanentDeletion } from './permanent-deletion.js';

export interface ProjectServiceDeps {
  projectsRepo: ProjectsRepo;
  fs: FsRepository;
  inbox: InboxService;
  coordinator: WriteCoordinator;
  /** Permanent deletion of a project folder with everything in it. */
  deletion: PermanentDeletion;
  /** Override for tests. */
  now?: () => string;
}

/** `project.delete`, as received: the Idempotency-Key unvalidated. */
export interface DeleteProjectCommand {
  operationId: unknown;
  projectId: string;
}

export class ProjectService {
  private readonly projectsRepo: ProjectsRepo;
  private readonly fs: FsRepository;
  private readonly inbox: InboxService;
  private readonly coordinator: WriteCoordinator;
  private readonly deletion: PermanentDeletion;
  private readonly now: () => string;

  constructor(deps: ProjectServiceDeps) {
    this.projectsRepo = deps.projectsRepo;
    this.fs = deps.fs;
    this.inbox = deps.inbox;
    this.coordinator = deps.coordinator;
    this.deletion = deps.deletion;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /** Every project, except those a pending deletion hides. */
  list(): Project[] {
    return this.projectsRepo
      .list()
      .filter((p) => !this.coordinator.isProjectPendingDeletion(p.id))
      .map((p) => this.view(p));
  }

  get(id: string): Project {
    const project = this.projectsRepo.find(id);
    if (!project) throw new NotFoundError('PROJECT_NOT_FOUND', `Project not found: ${id}`);
    return this.view(project);
  }

  /**
   * Two-phase create: insert row, then create folder skeleton. If the
   * filesystem step fails the row is rolled back so the system stays
   * consistent.
   */
  async create(input: CreateProjectRequest): Promise<Project> {
    return this.coordinator.command({
      locate: () => ({ projects: [input.id] }),
      run: () => this.createHeld(input),
    });
  }

  private async createHeld(input: CreateProjectRequest): Promise<Project> {
    if (this.projectsRepo.exists(input.id)) {
      throw new ConflictError(
        'PROJECT_ALREADY_EXISTS',
        `Project already exists: ${input.id}`,
      );
    }
    const now = this.now();
    const project = this.projectsRepo.insert({
      id: input.id,
      name: input.name,
      description: input.description ?? null,
      readOnly: false,
      created_at: now,
      updated_at: now,
    });
    try {
      await this.fs.ensureProjectSkeleton(input.id);
    } catch (err) {
      this.projectsRepo.delete(input.id);
      throw err;
    }
    return this.view(project);
  }

  /**
   * Settings run under the project's queue and check the durable guards: a
   * pending project deletion blocks every setting, and while anything is
   * pending in the project `readOnly` and `metadataMode` cannot change. A
   * request mixing blocked and allowed changes is refused as a whole.
   */
  async update(id: string, input: UpdateProjectRequest): Promise<Project> {
    return this.coordinator.command({
      locate: () => {
        this.get(id);
        return { projects: [id] };
      },
      run: async (_located, scope) => {
        if (input.readOnly !== undefined || input.metadataMode !== undefined) {
          scope.assertNothingPendingIn(id);
        }
        if (input.readOnly === true && this.inbox.isInbox(id)) {
          throw inboxProtected('The Inbox cannot be made read-only.');
        }
        const updated = this.projectsRepo.update(id, {
          name: input.name,
          description: input.description,
          readOnly: input.readOnly,
          metadataMode: input.metadataMode,
          updated_at: this.now(),
        });
        return this.view(updated!);
      },
    });
  }

  /**
   * Permanently delete a project with every task, comment and file in its
   * folder (for a linked project: the link and the project's rows, never the
   * files it points at), as a resumable deletion (see `PermanentDeletion`),
   * never while anything is pending in the project. Retry-safe: a resent
   * request with the same Idempotency-Key gets the original acknowledgement.
   */
  async delete(command: DeleteProjectCommand): Promise<DeleteProjectAck> {
    const operationId = parseOperationId(command.operationId);
    const id = command.projectId;
    return this.coordinator.command({
      operation: {
        id: operationId,
        command: DELETE_PROJECT_COMMAND,
        fingerprint: operationFingerprint(DELETE_PROJECT_COMMAND, [id]),
      },
      locate: () => {
        this.get(id);
        return { projects: [id] };
      },
      run: async (_located, scope) => {
        const project = this.get(id);
        if (this.inbox.isInbox(id)) throw inboxProtected('The Inbox cannot be deleted.');
        scope.assertNothingPendingIn(id);
        if (project.readOnly) {
          throw new ConflictError(
            'PROJECT_READ_ONLY',
            'This project is read-only. Disable read-only mode before deleting it.',
          );
        }
        const { plan, intent } = await this.deletion.prepareProject(operationId, id);
        scope.intent(intent);
        const result = await this.deletion.advance(plan, (outcome, write) =>
          scope.complete(outcome, write),
        );
        // Stopped by an unexpected change: the deletion stays pending for review.
        if (!result.done) throw recoveryRequired(operationId);
        return result.ack as DeleteProjectAck;
      },
    });
  }

  private view(project: ProjectRecord): Project {
    return {
      ...project,
      isInbox: this.inbox.isInbox(project.id),
      linked: this.fs.isProjectSymlinkSync(project.id),
    };
  }
}

function inboxProtected(message: string): ConflictError {
  return new ConflictError('INBOX_PROTECTED', message);
}
