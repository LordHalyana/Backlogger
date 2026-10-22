import type { Db } from './db/database.js';
import { CommentsRepo } from './db/comments-repo.js';
import { DocumentsRepo } from './db/documents-repo.js';
import { OperationsRepo } from './db/operations-repo.js';
import { ProjectsRepo } from './db/projects-repo.js';
import { FsRepository, PathResolver, SidecarStore } from './fs/index.js';
import { BoardService } from './services/board-service.js';
import { COMMENT_COMMANDS, CommentRecovery } from './services/comment-recovery.js';
import { CommentService } from './services/comment-service.js';
import { DocumentService } from './services/document-service.js';
import { CurrentWorkService } from './services/current-work-service.js';
import { InboxService } from './services/inbox-service.js';
import { HealthService } from './services/health-service.js';
import { ImportService } from './services/import-service.js';
import { LinkService } from './services/link-service.js';
import { ProjectService } from './services/project-service.js';
import { ProjectQueue } from './services/project-queue.js';
import { RecoveryService } from './services/recovery-service.js';
import { TaskTransfer, TRANSFER_COMMAND } from './services/task-transfer.js';
import {
  DELETE_DOCUMENT_COMMAND,
  DELETE_PROJECT_COMMAND,
  PermanentDeletion,
} from './services/permanent-deletion.js';
import { ReindexService } from './services/reindex-service.js';
import { SearchService } from './services/search-service.js';
import { GraphService } from './services/graph-service.js';
import { TagsService } from './services/tags-service.js';
import { WorkspaceGate } from './services/workspace-gate.js';
import { WriteCoordinator } from './services/write-coordinator.js';
import { TemplateRegistry } from './templates/registry.js';

export const APP_VERSION = '0.3.0';

export interface AppContext {
  db: Db;
  resolver: PathResolver;
  fs: FsRepository;
  sidecarStore: SidecarStore;
  projectsRepo: ProjectsRepo;
  documentsRepo: DocumentsRepo;
  commentsRepo: CommentsRepo;
  operationsRepo: OperationsRepo;
  projectService: ProjectService;
  inboxService: InboxService;
  documentService: DocumentService;
  commentService: CommentService;
  recoveryService: RecoveryService;
  boardService: BoardService;
  currentWorkService: CurrentWorkService;
  reindexService: ReindexService;
  searchService: SearchService;
  linkService: LinkService;
  tagsService: TagsService;
  graphService: GraphService;
  queue: ProjectQueue;
  coordinator: WriteCoordinator;
  templates: TemplateRegistry;
  healthService: HealthService;
  importService: ImportService;
  builtinTemplatesDir: string;
  userTemplatesDir: string;
  dataDir: string;
}

export interface BuildContextOptions {
  db: Db;
  dataDir: string;
  templates?: TemplateRegistry;
  builtinTemplatesDir?: string;
  userTemplatesDir?: string;
}

export function buildContext(opts: BuildContextOptions): AppContext {
  const resolver = new PathResolver({ dataDir: opts.dataDir });
  const fs = new FsRepository({ resolver });
  const sidecarStore = new SidecarStore(resolver);
  const projectsRepo = new ProjectsRepo(opts.db);
  const documentsRepo = new DocumentsRepo(opts.db);
  const commentsRepo = new CommentsRepo(opts.db);
  const templates = opts.templates ?? new TemplateRegistry();
  const builtinTemplatesDir = opts.builtinTemplatesDir ?? '';
  const userTemplatesDir = opts.userTemplatesDir ?? '';
  const inboxService = new InboxService({ projectsRepo, fs, dataDir: opts.dataDir });
  const linkService = new LinkService(opts.db);
  const tagsService = new TagsService(opts.db);
  const graphService = new GraphService(opts.db);
  const operationsRepo = new OperationsRepo(opts.db);
  const queue = new ProjectQueue();
  const coordinator = new WriteCoordinator({
    db: opts.db,
    operations: operationsRepo,
    gate: new WorkspaceGate(),
    queue,
    invalidate: (projectIds) => projectIds.forEach((id) => graphService.invalidate(id)),
  });
  const deletion = new PermanentDeletion({
    coordinator,
    documentsRepo,
    commentsRepo,
    projectsRepo,
    linkService,
    sidecarStore,
    fs,
  });
  coordinator.onRecover(DELETE_DOCUMENT_COMMAND, deletion);
  coordinator.onRecover(DELETE_PROJECT_COMMAND, deletion);
  const projectService = new ProjectService({
    projectsRepo,
    fs,
    inbox: inboxService,
    coordinator,
    deletion,
  });
  const transfer = new TaskTransfer({ coordinator, documentsRepo, commentsRepo, fs });
  coordinator.onRecover(TRANSFER_COMMAND, transfer);
  const documentService = new DocumentService({
    documentsRepo,
    projectsRepo,
    fs,
    templates,
    linkService,
    tagsService,
    sidecarStore,
    coordinator,
    transfer,
    deletion,
    inbox: inboxService,
  });
  const commentService = new CommentService({
    commentsRepo,
    documentsRepo,
    projectsRepo,
    fs,
    coordinator,
  });
  const commentRecovery = new CommentRecovery({ commentsRepo, documentsRepo, fs });
  for (const command of COMMENT_COMMANDS) coordinator.onRecover(command, commentRecovery);
  const recoveryService = new RecoveryService({ coordinator, documentsRepo });
  const reindexService = new ReindexService({
    documentsRepo,
    commentsRepo,
    projectsRepo,
    fs,
    linkService,
    tagsService,
    graphService,
    sidecarStore,
    coordinator,
    transfer,
    inbox: inboxService,
  });
  const boardService = new BoardService({ documentsRepo, projectsRepo });
  const currentWorkService = new CurrentWorkService({
    documentsRepo,
    projectsRepo,
    inbox: inboxService,
  });
  const searchService = new SearchService(opts.db);
  const healthService = new HealthService({
    db: opts.db,
    dataDir: opts.dataDir,
    templates,
    version: APP_VERSION,
  });
  const importService = new ImportService({
    documentsRepo,
    documentService,
    operations: operationsRepo,
  });
  return {
    db: opts.db,
    resolver,
    fs,
    sidecarStore,
    projectsRepo,
    documentsRepo,
    commentsRepo,
    operationsRepo,
    projectService,
    inboxService,
    documentService,
    commentService,
    recoveryService,
    boardService,
    currentWorkService,
    reindexService,
    searchService,
    linkService,
    tagsService,
    graphService,
    queue,
    coordinator,
    templates,
    healthService,
    importService,
    builtinTemplatesDir,
    userTemplatesDir,
    dataDir: opts.dataDir,
  };
}
