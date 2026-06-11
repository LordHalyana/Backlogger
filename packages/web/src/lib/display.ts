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
  canvasBackground: 'transparent',
} as const;
