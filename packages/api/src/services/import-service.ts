import matter from 'gray-matter';
import {
  isDocumentStatus,
  isDocumentType,
  type DocumentType,
  type ImportFile,
  type ImportPlacement,
  type ImportResult,
} from '@backlogger/shared';
import type { DocumentsRepo } from '../db/documents-repo.js';
import type { DocumentService } from './document-service.js';
import { ConflictError, HttpError, NotFoundError } from '../errors.js';

export interface ImportServiceDeps {
  documentsRepo: DocumentsRepo;
  documentService: DocumentService;
}

/**
 * Imports user-supplied Markdown files into a project.
 *
 * Pipeline per file:
 *   1. Parse frontmatter (gray-matter).
 *   2. Derive title per `placement.titleStrategy`.
 *   3. If frontmatter `id` matches an existing document in the same project →
 *      apply `placement.onDuplicate` (skip / copy / replace).
 *   4. Otherwise delegate to `DocumentService.create` so links + tags + FTS
 *      are updated by the same transactional path as in-app creates.
 *
 * The service never writes raw bytes — `DocumentService` is the single
 * disk-write path. That keeps `<slug>-<hash>.md` naming and frontmatter
 * serialization consistent with everything else.
 */
export class ImportService {
  constructor(private readonly deps: ImportServiceDeps) {}

  async importFiles(
    projectId: string,
    files: ImportFile[],
    placement: ImportPlacement,
  ): Promise<ImportResult> {
    const result: ImportResult = { imported: [], skipped: [], errors: [] };

    for (const file of files) {
      try {
        await this.importOne(projectId, file, placement, result);
      } catch (err) {
        // Bubble project-not-found and similar API errors — those abort the
        // whole request rather than landing in per-file errors.
        if (err instanceof NotFoundError && err.code === 'PROJECT_NOT_FOUND') throw err;
        if (err instanceof ConflictError && err.code === 'PROJECT_READ_ONLY') throw err;
        result.errors.push({
          filename: file.filename,
          code: 'INVALID_FRONTMATTER',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return result;
  }

  private async importOne(
    projectId: string,
    file: ImportFile,
    placement: ImportPlacement,
    result: ImportResult,
  ): Promise<void> {
    if (file.content.trim().length === 0) {
      result.errors.push({
        filename: file.filename,
        code: 'EMPTY_FILE',
        message: 'File is empty',
      });
      return;
    }

    let parsed: ReturnType<typeof matter>;
    try {
      parsed = matter(file.content);
    } catch (err) {
      result.errors.push({
        filename: file.filename,
        code: 'INVALID_FRONTMATTER',
        message: err instanceof Error ? err.message : 'Failed to parse frontmatter',
      });
      return;
    }

    const fmRaw = parsed.data as Record<string, unknown>;
    const body = parsed.content;

    // Duplicate detection: only via frontmatter `id` (round-trip from a
    // previous export). Files without `id` are always treated as new.
    const fmId = typeof fmRaw.id === 'string' ? fmRaw.id : undefined;
    if (fmId) {
      const existing = this.deps.documentsRepo.find(fmId);
      if (existing && existing.project_id === projectId) {
        if (placement.onDuplicate === 'skip') {
          result.skipped.push({
            filename: file.filename,
            reason: 'duplicate',
            existingId: existing.id,
          });
          return;
        }
        if (placement.onDuplicate === 'replace') {
          const title = deriveTitle(file, fmRaw, body, placement.titleStrategy) ?? existing.title;
          // task_state is overwritten only when the incoming file has one.
          const updated = await this.deps.documentService.update(
            existing.id,
            {
              title,
              body,
              tags: Array.isArray(fmRaw.tags)
                ? (fmRaw.tags as unknown[]).filter((t): t is string => typeof t === 'string')
                : existing.tags,
            },
            undefined,
            { importedTaskState: fmRaw.task_state },
          );
          result.imported.push({
            filename: file.filename,
            documentId: updated.id,
            title: updated.title,
          });
          return;
        }
        // onDuplicate === 'copy' → fall through to create with a new id.
      }
    }

    const title = deriveTitle(file, fmRaw, body, placement.titleStrategy);
    if (!title) {
      result.errors.push({
        filename: file.filename,
        code: 'TITLE_DERIVATION_FAILED',
        message: `Could not derive a title using strategy '${placement.titleStrategy}'`,
      });
      return;
    }

    const type: DocumentType =
      typeof fmRaw.type === 'string' && isDocumentType(fmRaw.type) ? fmRaw.type : placement.type;
    const status =
      typeof fmRaw.status === 'string' && isDocumentStatus(fmRaw.status) ? fmRaw.status : undefined;
    const tags = Array.isArray(fmRaw.tags)
      ? (fmRaw.tags as unknown[]).filter((t): t is string => typeof t === 'string')
      : undefined;

    try {
      // New and copied backlog items keep the incoming task_state verbatim;
      // a file without one stays without one.
      const created = await this.deps.documentService.create(
        projectId,
        { title, type, status, tags, body },
        { importedTaskState: { value: fmRaw.task_state } },
      );
      result.imported.push({
        filename: file.filename,
        documentId: created.id,
        title: created.title,
      });
    } catch (err) {
      // Validation throws from DocumentService.create land here.
      if (err instanceof NotFoundError && err.code === 'PROJECT_NOT_FOUND') throw err;
      if (err instanceof ConflictError && err.code === 'PROJECT_READ_ONLY') throw err;
      if (err instanceof HttpError) {
        result.errors.push({
          filename: file.filename,
          code: 'INVALID_FRONTMATTER',
          message: err.message,
        });
        return;
      }
      throw err;
    }
  }
}

function deriveTitle(
  file: ImportFile,
  fm: Record<string, unknown>,
  body: string,
  strategy: ImportPlacement['titleStrategy'],
): string | undefined {
  const fromFrontmatter = typeof fm.title === 'string' ? fm.title.trim() : undefined;
  const fromH1 = firstH1(body);
  const fromFilename = file.filename.replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim();

  switch (strategy) {
    case 'frontmatter':
      return fromFrontmatter || fromH1 || fromFilename || undefined;
    case 'h1':
      return fromH1 || fromFrontmatter || fromFilename || undefined;
    case 'filename':
      return fromFilename || fromFrontmatter || fromH1 || undefined;
  }
}

function firstH1(body: string): string | undefined {
  const m = body.match(/^\s*#\s+(.+?)\s*$/m);
  return m ? m[1] : undefined;
}
