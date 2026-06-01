import type { HealthStatus, SubsystemState } from '@backlogger/shared';
import type { Db } from '../db/database.js';
import type { TemplateRegistry } from '../templates/registry.js';
import { createDatabaseProbe } from '../health/probes/database.js';
import { createFtsProbe } from '../health/probes/fts.js';
import { createStorageProbe } from '../health/probes/storage.js';
import { createTemplatesProbe } from '../health/probes/templates.js';

const TTL_MS = 2_000;

const STATE_ORDER: Record<SubsystemState, number> = {
  ok: 0,
  degraded: 1,
  error: 2,
};

function worst(...states: SubsystemState[]): SubsystemState {
  return states.reduce<SubsystemState>(
    (acc, s) => (STATE_ORDER[s] > STATE_ORDER[acc] ? s : acc),
    'ok',
  );
}

export interface HealthServiceOptions {
  db: Db;
  dataDir: string;
  templates: TemplateRegistry;
  version: string;
  /** Optional override for the cache TTL (ms). Useful for tests. */
  ttlMs?: number;
  /** Optional clock override for deterministic tests. */
  now?: () => number;
  /** Optional process-uptime override for tests. */
  uptime?: () => number;
}

/**
 * Aggregates per-subsystem health probes into a single cached snapshot.
 *
 * The endpoint can be hammered by monitoring agents; we serve a cached value
 * for `TTL_MS` to keep the cost bounded.
 */
export class HealthService {
  private cache: { value: HealthStatus; expires: number } | null = null;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly uptime: () => number;
  private readonly version: string;
  private readonly probeDatabase: () => SubsystemState;
  private readonly probeStorage: () => SubsystemState;
  private readonly probeTemplates: () => SubsystemState;
  private readonly probeFts: () => SubsystemState;

  constructor(opts: HealthServiceOptions) {
    this.ttlMs = opts.ttlMs ?? TTL_MS;
    this.now = opts.now ?? Date.now;
    this.uptime = opts.uptime ?? (() => process.uptime());
    this.version = opts.version;
    this.probeDatabase = createDatabaseProbe(opts.db);
    this.probeStorage = createStorageProbe(opts.dataDir);
    this.probeTemplates = createTemplatesProbe(opts.templates);
    this.probeFts = createFtsProbe(opts.db);
  }

  /** Returns the cached snapshot, refreshing it if expired. */
  snapshot(): HealthStatus {
    const t = this.now();
    if (this.cache && t < this.cache.expires) return this.cache.value;
    const value = this.compute(t);
    this.cache = { value, expires: t + this.ttlMs };
    return value;
  }

  /** Force-refreshes the cached snapshot. */
  refresh(): HealthStatus {
    this.cache = null;
    return this.snapshot();
  }

  private compute(t: number): HealthStatus {
    // `api === 'ok'` whenever we can serve the request at all.
    const api: SubsystemState = 'ok';
    const database = safe(this.probeDatabase);
    const storage = safe(this.probeStorage);
    const templates = safe(this.probeTemplates);
    const fts = safe(this.probeFts);
    const uptime = this.uptime();
    return {
      status: worst(api, database, storage, templates, fts),
      api,
      database,
      storage,
      templates,
      fts,
      version: this.version,
      uptime,
      uptime_s: Math.round(uptime),
      checked_at: new Date(t).toISOString(),
    };
  }
}

function safe(probe: () => SubsystemState): SubsystemState {
  try {
    return probe();
  } catch {
    return 'error';
  }
}
