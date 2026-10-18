import type { CreateProjectRequest, Project, UpdateProjectRequest } from '@backlogger/shared';
import type { FsRepository } from '../fs/index.js';
import type { ProjectRecord, ProjectsRepo } from '../db/projects-repo.js';
import type { InboxService } from './inbox-service.js';
import { ConflictError, NotFoundError } from '../errors.js';

export interface ProjectServiceDeps {
  projectsRepo: ProjectsRepo;
  fs: FsRepository;
  inbox: InboxService;
  /** Override for tests. */
  now?: () => string;
}

export class ProjectService {
  private readonly projectsRepo: ProjectsRepo;
  private readonly fs: FsRepository;
  private readonly inbox: InboxService;
  private readonly now: () => string;

  constructor(deps: ProjectServiceDeps) {
    this.projectsRepo = deps.projectsRepo;
    this.fs = deps.fs;
    this.inbox = deps.inbox;
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

  update(id: string, input: UpdateProjectRequest): Project {
    if (!this.projectsRepo.exists(id)) {
      throw new NotFoundError('PROJECT_NOT_FOUND', `Project not found: ${id}`);
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
  }

  /**
   * Delete the metadata row first, then the folder. If the disk step
   * fails the caller still gets a 204; a future reindex reconciles any
   * orphaned folder.
   */
  async delete(id: string): Promise<void> {
    const project = this.projectsRepo.find(id);
    if (!project) {
      throw new NotFoundError('PROJECT_NOT_FOUND', `Project not found: ${id}`);
    }
    if (this.inbox.isInbox(id)) throw inboxProtected('The Inbox cannot be deleted.');
    if (project.readOnly) {
      throw new ConflictError(
        'PROJECT_READ_ONLY',
        'This project is read-only. Disable read-only mode before deleting it.',
      );
    }
    this.projectsRepo.delete(id);
    await this.fs.removeProject(id).catch(() => undefined);
  }

  private view(project: ProjectRecord): Project {
    return { ...project, isInbox: this.inbox.isInbox(project.id) };
  }
}

function inboxProtected(message: string): ConflictError {
  return new ConflictError('INBOX_PROTECTED', message);
}
