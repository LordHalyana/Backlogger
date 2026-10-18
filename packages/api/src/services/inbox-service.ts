import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ProjectIdSchema } from '@backlogger/shared';
import type { FsRepository } from '../fs/index.js';
import type { ProjectsRepo } from '../db/projects-repo.js';
import { HttpError } from '../errors.js';
import { logger } from '../logger.js';

export const INBOX_NAME = 'Inbox';

/** `<dataDir>/workspace.json`: the only record of which project is the Inbox. */
interface WorkspaceFile {
  inbox_project_id: string;
}

export interface InboxServiceDeps {
  projectsRepo: ProjectsRepo;
  fs: FsRepository;
  dataDir: string;
  now?: () => string;
}

/**
 * The designated Inbox: one native project that receives captures made
 * before a destination is chosen. Its designation lives on disk in
 * `workspace.json`, so it survives a rebuilt database; an existing project is
 * never adopted because of its id or name.
 */
export class InboxService {
  private readonly projectsRepo: ProjectsRepo;
  private readonly fs: FsRepository;
  private readonly workspaceFile: string;
  private readonly now: () => string;
  private inboxId: string | null = null;

  constructor(deps: InboxServiceDeps) {
    this.projectsRepo = deps.projectsRepo;
    this.fs = deps.fs;
    this.workspaceFile = path.join(path.resolve(deps.dataDir), 'workspace.json');
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /** The designated Inbox's id, or `null` when it could not be established. */
  id(): string | null {
    return this.inboxId;
  }

  isInbox(projectId: string): boolean {
    return this.inboxId !== null && this.inboxId === projectId;
  }

  /** The Inbox's id, or `500 INBOX_UNAVAILABLE`. */
  requireId(): string {
    if (this.inboxId === null) {
      throw new HttpError(500, 'INBOX_UNAVAILABLE', 'The Inbox is unavailable; capture into a project instead.');
    }
    return this.inboxId;
  }

  /**
   * Establish the Inbox at start, before requests are served. Never throws:
   * on failure the Inbox is unavailable and the rest of the app keeps working.
   */
  async ensure(): Promise<void> {
    try {
      this.inboxId = await this.establish();
    } catch (err) {
      this.inboxId = null;
      logger.error('inbox unavailable', err);
    }
  }

  private async establish(): Promise<string> {
    const recorded = await this.readWorkspaceFile();
    if (recorded) {
      const id = recorded.inbox_project_id;
      if (!(await this.fs.projectExists(id))) {
        logger.warn(`inbox folder '${id}' is missing; recreating an empty Inbox`);
      }
      await this.fs.ensureProjectSkeleton(id);
      this.register(id);
      return id;
    }

    const id = await this.freeId();
    await this.fs.ensureProjectSkeleton(id);
    this.register(id);
    await this.writeWorkspaceFile({ inbox_project_id: id });
    logger.info(`created Inbox project '${id}'`);
    return id;
  }

  /** `inbox`, or `inbox-2`, `inbox-3`, … — the first id with no row and no folder. */
  private async freeId(): Promise<string> {
    for (let n = 1; ; n += 1) {
      const id = n === 1 ? 'inbox' : `inbox-${n}`;
      if (!this.projectsRepo.exists(id) && !(await this.fs.projectExists(id))) return id;
    }
  }

  /** Make sure the Inbox has a writable row named "Inbox" (e.g. after a rebuilt database). */
  private register(id: string): void {
    const existing = this.projectsRepo.find(id);
    if (existing) return;
    const now = this.now();
    this.projectsRepo.insert({
      id,
      name: INBOX_NAME,
      description: null,
      readOnly: false,
      created_at: now,
      updated_at: now,
    });
  }

  private async readWorkspaceFile(): Promise<WorkspaceFile | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.workspaceFile, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    const parsed = JSON.parse(raw) as Partial<WorkspaceFile>;
    if (!ProjectIdSchema.safeParse(parsed.inbox_project_id).success) {
      throw new Error(`workspace.json has no valid inbox_project_id`);
    }
    return { inbox_project_id: parsed.inbox_project_id as string };
  }

  private async writeWorkspaceFile(content: WorkspaceFile): Promise<void> {
    const serialized = `${JSON.stringify(content, null, 2)}\n`;
    const tmp = `${this.workspaceFile}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`;
    await fs.mkdir(path.dirname(this.workspaceFile), { recursive: true });
    await fs.writeFile(tmp, serialized, { encoding: 'utf8', flag: 'wx' });
    try {
      await fs.rename(tmp, this.workspaceFile);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }
}
