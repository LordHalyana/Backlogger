import type { Db } from './db/database.js';
import { DocumentsRepo } from './db/documents-repo.js';
import { ProjectsRepo } from './db/projects-repo.js';
import { FsRepository, PathResolver } from './fs/index.js';
import { DocumentService } from './services/document-service.js';
import { HealthService } from './services/health-service.js';
import { ImportService } from './services/import-service.js';
import { LinkService } from './services/link-service.js';
import { ProjectService } from './services/project-service.js';
import { ReindexService } from './services/reindex-service.js';
import { SearchService } from './services/search-service.js';
import { GraphService } from './services/graph-service.js';
import { TagsService } from './services/tags-service.js';
import { TemplateRegistry } from './templates/registry.js';

export const APP_VERSION = '0.3.0';

export interface AppContext {
  db: Db;
  resolver: PathResolver;
  fs: FsRepository;
  projectsRepo: ProjectsRepo;
  documentsRepo: DocumentsRepo;
  projectService: ProjectService;
  documentService: DocumentService;
  reindexService: ReindexService;
  searchService: SearchService;
  linkService: LinkService;
  tagsService: TagsService;
  graphService: GraphService;
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
  const projectsRepo = new ProjectsRepo(opts.db);
  const documentsRepo = new DocumentsRepo(opts.db);
  const templates = opts.templates ?? new TemplateRegistry();
  const builtinTemplatesDir = opts.builtinTemplatesDir ?? '';
  const userTemplatesDir = opts.userTemplatesDir ?? '';
  const projectService = new ProjectService({ projectsRepo, fs });
  const linkService = new LinkService(opts.db);
  const tagsService = new TagsService(opts.db);
  const graphService = new GraphService(opts.db);
  const documentService = new DocumentService({
    documentsRepo,
    projectsRepo,
    fs,
    templates,
    linkService,
    tagsService,
    graphService,
  });
  const reindexService = new ReindexService({ documentsRepo, projectsRepo, fs, linkService, tagsService, graphService });
  const searchService = new SearchService(opts.db);
  const healthService = new HealthService({
    db: opts.db,
    dataDir: opts.dataDir,
    templates,
    version: APP_VERSION,
  });
  const importService = new ImportService({ documentsRepo, documentService });
  return {
    db: opts.db,
    resolver,
    fs,
    projectsRepo,
    documentsRepo,
    projectService,
    documentService,
    reindexService,
    searchService,
    linkService,
    tagsService,
    graphService,
    templates,
    healthService,
    importService,
    builtinTemplatesDir,
    userTemplatesDir,
    dataDir: opts.dataDir,
  };
}
