/**
 * JSON Schema (draft-07) for the `/health` response.
 *
 * Hand-authored — the shape is small and stable, and avoiding a runtime
 * conversion library keeps the dependency footprint flat. Kept next to the
 * probes so any payload change here forces a schema bump in the same PR.
 *
 * Served by `GET /health/schema` for Home System (and any other monitor) to
 * validate poll responses on bootstrap.
 */

const subsystemState = {
  type: 'string',
  enum: ['ok', 'degraded', 'error'],
} as const;

export const HEALTH_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://backlogger.local/schemas/health.json',
  title: 'HealthResponse',
  type: 'object',
  additionalProperties: false,
  required: [
    'status',
    'api',
    'database',
    'storage',
    'templates',
    'fts',
    'version',
    'uptime',
    'uptime_s',
    'checked_at',
  ],
  properties: {
    status: subsystemState,
    api: subsystemState,
    database: subsystemState,
    storage: subsystemState,
    templates: subsystemState,
    fts: subsystemState,
    version: { type: 'string', minLength: 1 },
    uptime: { type: 'number', minimum: 0 },
    uptime_s: { type: 'integer', minimum: 0 },
    checked_at: { type: 'string', format: 'date-time' },
  },
} as const;
