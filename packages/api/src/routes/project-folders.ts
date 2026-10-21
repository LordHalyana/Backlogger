import { Router } from 'express';
import { FolderPathSchema } from '@backlogger/shared';
import { ConflictError, NotFoundError } from '../errors.js';
import type { ProjectService } from '../services/project-service.js';
import type { FsRepository } from '../fs/index.js';
import type { WriteCoordinator } from '../services/write-coordinator.js';
import { asyncRoute, validateBody } from './util.js';
import { parseProjectId } from './route-params.js';

export function projectFoldersRouter(
  projectService: ProjectService,
  fs: FsRepository,
  coordinator: WriteCoordinator,
): Router {
  const router = Router();

  /** Folder changes are coordinated commands on the project's queue. */
  const inProject = <T>(id: string, operation: () => Promise<T>): Promise<T> =>
    coordinator.command({
      locate: () => {
        projectService.get(id); // 404 if unknown
        return { projects: [id] };
      },
      run: () => {
        assertProjectWritable(id);
        return operation();
      },
    });

  const assertProjectWritable = (id: string): void => {
    const project = projectService.get(id);
    if (project.readOnly) {
      throw new ConflictError(
        'PROJECT_READ_ONLY',
        'This project is read-only. Disable read-only mode before editing it.',
      );
    }
  };

  router.get(
    '/:id/folders',
    asyncRoute(async (req, res) => {
      const id = parseProjectId(req.params.id);
      projectService.get(id); // 404 if unknown
      const folders = await fs.listFolders(id);
      res.json(folders);
    }),
  );

  router.post(
    '/:id/folders',
    asyncRoute(async (req, res) => {
      const id = parseProjectId(req.params.id);
      const body = req.body as { folder?: unknown } | undefined;
      const requested = validateBody(FolderPathSchema, body?.folder);
      const folder = await inProject(id, () => fs.createFolder(id, requested));
      res.status(201).json({ folder });
    }),
  );

  // See docs/design/folder-invariants.md for the rules governing folder deletion.
  router.delete(
    '/:id/folders/*',
    asyncRoute(async (req, res) => {
      const id = parseProjectId(req.params.id);
      const raw = (req.params as { 0?: string })[0] ?? '';
      const folder = validateBody(FolderPathSchema, decodeURIComponent(raw));
      await inProject(id, () => removeEmptyFolder(id, folder));
      res.status(204).send();
    }),
  );

  const removeEmptyFolder = async (id: string, folder: string): Promise<void> => {
    const existing = await fs.listFolders(id);
    if (!existing.includes(folder)) {
      throw new NotFoundError('FOLDER_NOT_FOUND', `Folder not found: ${folder}`);
    }
    const files = await fs.listProjectFiles(id);
    const prefix = `${id}/${folder}/`;
    const occupied = files.some((p) => p.startsWith(prefix));
    const hasSubfolder = existing.some((f) => f.startsWith(`${folder}/`));
    if (occupied || hasSubfolder) {
      throw new ConflictError('FOLDER_NOT_EMPTY', `Folder not empty: ${folder}`);
    }
    await fs.removeFolder(id, folder);
  };

  return router;
}
