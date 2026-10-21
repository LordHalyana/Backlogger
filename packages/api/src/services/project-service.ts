import type { CreateProjectRequest, Project, UpdateProjectRequest } from '@backlogger/shared';
import type { FsRepository } from '../fs/index.js';
import type { ProjectRecord, ProjectsRepo } from '../db/projects-repo.js';
import type { InboxService } from './inbox-service.js';
import { ConflictError, NotFoundError } from '../errors.js';
import type { WriteCoordinator } from './write-coordinator.js';

export interface ProjectServiceDeps {
  projectsRepo: ProjectsRepo;
  fs: FsRepository;
  inbox: InboxService;
  coordinator: WriteCoordinator;
  /** Override for tests. */
  now?: () => string;
}

export class ProjectService {
  private readonly projectsRepo: ProjectsRepo;
  private readonly fs: FsRepository;
  private readonly inbox: InboxService;
  private readonly coordinator: WriteCoordinator;
  private readonly now: () => string;

  constructor(deps: ProjectServiceDeps) {
    this.projectsRepo = deps.projectsRepo;
    this.fs = deps.fs;
    this.inbox = deps.inbox;
    this.coordinator = deps.coordinator;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  list(): Project[] {
    return this.projectsRepo.list().map((p) => this.view(p));
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
   * Delete the folder first, then the metadata row, inside the project's
   * queue so no document operation interleaves, and never while anything is
   * pending in the project. If the folder cannot be
   * (fully) removed the error surfaces and the project stays indexed; a retry
   * finishes the job, and a reindex never resurrects a deleted project.
   */
  async delete(id: string): Promise<void> {
    return this.coordinator.command({
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
        await this.fs.removeProject(id);
        this.projectsRepo.delete(id);
      },
    });
  }

  private view(project: ProjectRecord): Project {
    return { ...project, isInbox: this.inbox.isInbox(project.id) };
  }
}

function inboxProtected(message: string): ConflictError {
  return new ConflictError('INBOX_PROTECTED', message);
}
