import type { CreateProjectRequest, Project, UpdateProjectRequest } from '@backlogger/shared';
import type { FsRepository } from '../fs/index.js';
import type { ProjectsRepo } from '../db/projects-repo.js';
import { ConflictError, NotFoundError } from '../errors.js';

export interface ProjectServiceDeps {
  projectsRepo: ProjectsRepo;
  fs: FsRepository;
  /** Override for tests. */
  now?: () => string;
}

export class ProjectService {
  private readonly projectsRepo: ProjectsRepo;
  private readonly fs: FsRepository;
  private readonly now: () => string;

  constructor(deps: ProjectServiceDeps) {
    this.projectsRepo = deps.projectsRepo;
    this.fs = deps.fs;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  list(): Project[] {
    return this.projectsRepo.list();
  }

  get(id: string): Project {
    const project = this.projectsRepo.find(id);
    if (!project) throw new NotFoundError('PROJECT_NOT_FOUND', `Project not found: ${id}`);
    return project;
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
    return project;
  }

  update(id: string, input: UpdateProjectRequest): Project {
    if (!this.projectsRepo.exists(id)) {
      throw new NotFoundError('PROJECT_NOT_FOUND', `Project not found: ${id}`);
    }
    const updated = this.projectsRepo.update(id, {
      name: input.name,
      description: input.description,
      readOnly: input.readOnly,
      metadataMode: input.metadataMode,
      updated_at: this.now(),
    });
    return updated!;
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
    if (project.readOnly) {
      throw new ConflictError(
        'PROJECT_READ_ONLY',
        'This project is read-only. Disable read-only mode before deleting it.',
      );
    }
    this.projectsRepo.delete(id);
    await this.fs.removeProject(id).catch(() => undefined);
  }
}
