import { z } from 'zod';
import type { DocumentStatus } from './documents.js';

/**
 * Task state: how far the work in a backlog item has progressed. Kept separate
 * from document status (lifecycle). Stored in frontmatter as `task_state`,
 * immediately after `status`, with exactly these spellings.
 */
export const TASK_STATES = ['todo', 'in_progress', 'done'] as const;

export const TaskStateSchema = z.enum(TASK_STATES);
export type TaskState = z.infer<typeof TaskStateSchema>;

export const TASK_STATE_LABELS: Record<TaskState, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

/** Type guard: is `value` a recognised task state (exact, case-sensitive)? */
export function isTaskState(value: unknown): value is TaskState {
  return typeof value === 'string' && (TASK_STATES as readonly string[]).includes(value);
}

/**
 * The board column a stored `task_state` displays in. Absent and unrecognised
 * values (e.g. `Doing`) show as To do; they are kept as written until moved.
 */
export function taskStateColumn(raw: string | null | undefined): TaskState {
  return isTaskState(raw) ? raw : 'todo';
}

/** One card on the board: a summary of a non-archived backlog item. */
export interface BoardCard {
  id: string;
  title: string;
  tags: string[];
  status: DocumentStatus;
  readOnly: boolean;
  revision: string;
  /** The stored value, verbatim; `null` when the file has none. */
  task_state: string | null;
  created_at: string;
}

/** `GET /api/projects/:projectId/board`. Each column is in creation order. */
export interface Board {
  columns: Record<TaskState, BoardCard[]>;
}

/** The project heading of a Current work group. */
export interface CurrentWorkProject {
  id: string;
  name: string;
  readOnly: boolean;
  isInbox: boolean;
}

/**
 * `GET /api/current-work`: In progress backlog items across native projects,
 * grouped by project (Inbox first, then by name), each group in creation
 * order. Projects with nothing In progress are omitted.
 */
export interface CurrentWork {
  groups: Array<{ project: CurrentWorkProject; items: BoardCard[] }>;
}

/** The index projection of a frontmatter `task_state` value, kept verbatim. */
export function storedTaskState(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
