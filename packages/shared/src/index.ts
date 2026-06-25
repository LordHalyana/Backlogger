export type SubsystemState = 'ok' | 'degraded' | 'error';

export interface HealthStatus {
  /** Worst subsystem state — `'ok'` only when every subsystem is healthy. */
  status: SubsystemState;
  api: SubsystemState;
  database: SubsystemState;
  storage: SubsystemState;
  templates: SubsystemState;
  fts: SubsystemState;
  version: string;
  /** Process uptime in seconds. */
  uptime: number;
  /** Alias of `uptime` for monitoring clients that expect snake_case. */
  uptime_s: number;
  /** ISO 8601 timestamp of when the probes were last refreshed. */
  checked_at: string;
}

export * from './projects.js';
export * from './documents.js';
export * from './paths.js';
export * from './templates.js';
export * from './errors.js';
export * from './markdown.js';
export * from './search.js';
export * from './wiki-link.js';
export * from './tags.js';
export * from './import.js';
export * from './sidecar.js';
