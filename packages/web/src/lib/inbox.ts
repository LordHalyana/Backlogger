import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  TASK_STATES,
  type Board,
  type Document,
  type FileDocumentAck,
  type Project,
  type TaskState,
} from '@backlogger/shared';
import { apiFetch } from './api.js';
import {
  invalidateComments,
  invalidateDocumentDerived,
  queryKeys,
  setDocumentCache,
} from './query-keys.js';

/** Inbox first, then by name. */
export function orderProjects(projects: readonly Project[]): Project[] {
  return [...projects].sort(
    (a, b) => Number(b.isInbox) - Number(a.isInbox) || a.name.localeCompare(b.name),
  );
}

/** A project that can take a new or filed backlog item: writable and frontmatter-mode. */
export function acceptsBacklogItems(project: Project): boolean {
  return !project.readOnly && project.metadataMode !== 'sidecar';
}

const RECENT_KEY = 'backlogger.recentFilingTargets';

/** Project ids most recently filed into, newest first (a per-browser convenience). */
export function readRecentTargets(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberTarget(projectId: string): void {
  try {
    const next = [projectId, ...readRecentTargets().filter((id) => id !== projectId)].slice(0, 20);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the order just falls back to names.
  }
}

/** Where Inbox items can be filed: writable native projects, most recently used first. */
export function filingTargets(projects: readonly Project[], recent: readonly string[]): Project[] {
  const rank = (id: string): number => {
    const i = recent.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return projects
    .filter((p) => !p.isInbox && acceptsBacklogItems(p))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
}

export interface FileItemArgs {
  id: string;
  revision: string;
  from: string;
  to: string;
  /**
   * The Idempotency-Key, generated when the user acts (`newUuid`); resending
   * the same filing reuses it.
   */
  operationId: string;
}

/**
 * File a backlog item, with its comments, into another project; it keeps its
 * id. The server answers with an acknowledgement only, so the item and its
 * comments are refetched afterwards.
 */
export function useFileItem(): UseMutationResult<FileDocumentAck, Error, FileItemArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, revision, to, operationId }) =>
      apiFetch<FileDocumentAck>(`/api/documents/${id}/file`, {
        method: 'POST',
        headers: { 'Idempotency-Key': operationId },
        body: JSON.stringify({ target_project_id: to, revision }),
      }),
    onSettled: (_ack, _err, { id, from, to }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.document(id) });
      void invalidateComments(qc, id);
      invalidateDocumentDerived(qc, from);
      invalidateDocumentDerived(qc, to);
    },
  });
}

/** What triage and Current work change on a backlog item: its task state, or archive it. */
export type ItemChange = { task_state: TaskState } | { status: 'archived' };

export interface UpdateItemArgs {
  id: string;
  projectId: string;
  revision: string;
  change: ItemChange;
}

/** A conditional (If-Match) task-state change or archive of one backlog item. */
export function useUpdateItem(): UseMutationResult<Document, Error, UpdateItemArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, revision, change }) =>
      apiFetch<Document>(`/api/documents/${id}`, {
        method: 'PUT',
        headers: { 'If-Match': revision },
        body: JSON.stringify(change),
      }),
    onSuccess: (doc) => setDocumentCache(qc, doc),
    onSettled: (_doc, _err, { projectId }) => invalidateDocumentDerived(qc, projectId),
  });
}

/**
 * How many items wait in the Inbox (every non-archived backlog item there),
 * sharing the Inbox board's cache; `null` while unknown or without an Inbox.
 */
export function useInboxCount(inboxId: string | undefined): number | null {
  const { data } = useQuery({
    queryKey: queryKeys.board(inboxId ?? ''),
    queryFn: () => apiFetch<Board>(`/api/projects/${inboxId}/board`),
    enabled: !!inboxId,
  });
  return data ? TASK_STATES.reduce((n, state) => n + data.columns[state].length, 0) : null;
}
