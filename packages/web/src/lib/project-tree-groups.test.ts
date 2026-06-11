import { describe, expect, it } from 'vitest';
import type { DocumentSummary } from '@backlogger/shared';
import { buildProjectTreeGroups, isAncestorCollapsed } from './project-tree-groups.js';

function doc(input: Partial<DocumentSummary> & Pick<DocumentSummary, 'id' | 'path'>): DocumentSummary {
  return {
    title: input.id,
    project_id: 'demo',
    type: 'note',
    status: 'active',
    tags: [],
    readOnly: false,
    created_at: '2026-06-09T00:00:00.000Z',
    updated_at: '2026-06-09T00:00:00.000Z',
    ...input,
  };
}

describe('project tree grouping', () => {
  it('groups documents by project-relative folder and keeps root docs separate', () => {
    const root = doc({ id: 'root', path: 'demo/root.md' });
    const nested = doc({ id: 'nested', path: 'demo/guides/setup.md' });

    const result = buildProjectTreeGroups('demo', [root, nested], []);

    expect(result.rootDocs).toEqual([root]);
    expect(result.grouped.get('guides')).toEqual([nested]);
    expect(result.activeFolders).toEqual(['guides']);
    expect(result.archivedFolders).toEqual([]);
  });

  it('includes empty folders and separates archived folders', () => {
    const archived = doc({
      id: 'old',
      path: 'demo/archived/notes/old.md',
      status: 'archived',
    });

    const result = buildProjectTreeGroups('demo', [archived], [
      'ideas',
      'archived/notes',
      'phases/p3',
    ]);

    expect(result.activeFolders).toEqual(['ideas', 'phases/p3']);
    expect(result.archivedFolders).toEqual(['archived/notes']);
    expect(result.grouped.get('archived/notes')).toEqual([archived]);
  });

  it('detects collapsed ancestor folders without hiding the folder itself', () => {
    const collapsed = new Set(['guides', 'reference/api']);

    expect(isAncestorCollapsed('guides', collapsed)).toBe(false);
    expect(isAncestorCollapsed('guides/setup', collapsed)).toBe(true);
    expect(isAncestorCollapsed('reference/api/auth', collapsed)).toBe(true);
    expect(isAncestorCollapsed('reference', collapsed)).toBe(false);
  });
});
