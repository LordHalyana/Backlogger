import type { SubsystemState } from '@backlogger/shared';
import type { TemplateRegistry } from '../../templates/registry.js';

/**
 * Number of built-in templates shipped with the API package. If the registry
 * has fewer entries we report `degraded` — the app still runs, but the
 * Document creation UX is missing affordances.
 */
const BUILTIN_COUNT = 5;

/**
 * Templates probe.
 *
 * - throw         → `error`
 * - count < N     → `degraded`
 * - count ≥ N     → `ok`
 */
export function createTemplatesProbe(
  registry: TemplateRegistry,
): () => SubsystemState {
  return (): SubsystemState => {
    try {
      const n = registry.list().length;
      return n >= BUILTIN_COUNT ? 'ok' : 'degraded';
    } catch {
      return 'error';
    }
  };
}
