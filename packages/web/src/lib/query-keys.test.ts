import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  invalidateComments,
  invalidateDocumentDerived,
  invalidateGlobalReindex,
  invalidateProjectList,
  invalidateProjectReload,
  queryKeys,
} from './query-keys.js';

/**
 * Search results go stale after every write that can change what search
 * finds: app saves and filing, comment writes, deletion, Reload and Reindex
 * (#70, spec #58).
 */
describe('search cache invalidation', () => {
  const cases: Array<[string, (qc: QueryClient) => void]> = [
    ['document saves and filing', (qc) => invalidateDocumentDerived(qc, 'work')],
    ['comment writes', (qc) => void invalidateComments(qc, 'task-1')],
    ['project deletion', (qc) => invalidateProjectList(qc)],
    ['Reload', (qc) => invalidateProjectReload(qc, 'work', [])],
    ['Reindex', (qc) => invalidateGlobalReindex(qc)],
  ];

  for (const [name, invalidate] of cases) {
    it(`after ${name}`, () => {
      const qc = new QueryClient();
      const key = [...queryKeys.search(), 'zebracorn', null, 20];
      qc.setQueryData(key, []);
      expect(qc.getQueryState(key)?.isInvalidated).toBe(false);
      invalidate(qc);
      expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    });
  }
});
