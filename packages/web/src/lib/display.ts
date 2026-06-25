import type { DocumentType, DocumentStatus } from '@backlogger/shared';

/** Human-readable label for each document type. */
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  idea:                'Idea',
  note:                'Note',
  design_doc:          'Design doc',
  implementation_plan: 'Implementation plan',
  backlog_item:        'Backlog item',
  finding:             'Finding',
};

/** Human-readable label for each document status. */
export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  draft:    'Draft',
  active:   'Active',
  archived: 'Archived',
};

/** Graph node fill color for each document type. */
export const DOCUMENT_TYPE_COLORS: Record<DocumentType, string> = {
  idea:                '#a78bfa',
  note:                '#60a5fa',
  design_doc:          '#34d399',
  implementation_plan: '#4ade80',
  backlog_item:        '#f59e0b',
  finding:             '#f87171',
};

export const GRAPH_COLORS = {
  brokenNode: '#ef4444',
  orphanNode: '#94a3b8',
  defaultNode: '#64748b',
  link: 'rgba(148,163,184,0.4)',
  linkDim: 'rgba(148,163,184,0.1)',
  canvasBackground: 'transparent',
} as const;

/**
 * Compact, human-readable process uptime.
 * Examples: `45s`, `12m`, `3h 20m`, `6d 22h`.
 */
export function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remMin = minutes % 60;
    return remMin ? `${hours}h ${remMin}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

/**
 * Relative timestamp for recent edits, with graceful fallbacks.
 * Examples: `just now`, `15m ago`, `today at 9:40 PM`, `Jun 24`, `Dec 31, 2025`.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const elapsedMs = now.getTime() - then.getTime();
  if (Number.isNaN(elapsedMs)) return '';
  const seconds = Math.round(elapsedMs / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const time = then.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (then.toDateString() === now.toDateString()) return `today at ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) return `yesterday at ${time}`;

  const sameYear = then.getFullYear() === now.getFullYear();
  return then.toLocaleDateString(
    undefined,
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { year: 'numeric', month: 'short', day: 'numeric' },
  );
}
