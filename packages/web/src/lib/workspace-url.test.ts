import { describe, it, expect, beforeEach } from 'vitest';
import {
  readWorkspaceFromUrl,
  workspacePathname,
  syncWorkspaceUrl,
} from './workspace-url';

function setPath(path: string): void {
  window.history.replaceState(null, '', path);
}

beforeEach(() => {
  setPath('/');
});

describe('workspacePathname', () => {
  it('returns "/" when no project is selected', () => {
    expect(workspacePathname(null, null)).toBe('/');
    expect(workspacePathname(null, 'doc-1')).toBe('/');
  });

  it('returns the project path when only a project is selected', () => {
    expect(workspacePathname('demo', null)).toBe('/projects/demo');
  });

  it('returns the document path when both are selected', () => {
    expect(workspacePathname('demo', 'doc-1')).toBe('/projects/demo/documents/doc-1');
  });

  it('encodes path segments', () => {
    expect(workspacePathname('a b', 'c/d')).toBe('/projects/a%20b/documents/c%2Fd');
  });
});

describe('readWorkspaceFromUrl', () => {
  it('returns nulls at the root', () => {
    setPath('/');
    expect(readWorkspaceFromUrl()).toEqual({ projectId: null, documentId: null });
  });

  it('reads a project-only path', () => {
    setPath('/projects/demo');
    expect(readWorkspaceFromUrl()).toEqual({ projectId: 'demo', documentId: null });
  });

  it('reads a project + document path', () => {
    setPath('/projects/demo/documents/doc-1');
    expect(readWorkspaceFromUrl()).toEqual({ projectId: 'demo', documentId: 'doc-1' });
  });

  it('decodes encoded segments', () => {
    setPath('/projects/a%20b/documents/c%2Fd');
    expect(readWorkspaceFromUrl()).toEqual({ projectId: 'a b', documentId: 'c/d' });
  });

  it('ignores unrelated paths', () => {
    setPath('/something/else');
    expect(readWorkspaceFromUrl()).toEqual({ projectId: null, documentId: null });
  });

  it('round-trips with workspacePathname', () => {
    setPath(workspacePathname('demo', 'doc-1'));
    expect(readWorkspaceFromUrl()).toEqual({ projectId: 'demo', documentId: 'doc-1' });
  });
});

describe('syncWorkspaceUrl', () => {
  it('pushes the new selection path', () => {
    setPath('/');
    syncWorkspaceUrl('demo', 'doc-1');
    expect(window.location.pathname).toBe('/projects/demo/documents/doc-1');
  });

  it('preserves the ?help= query string', () => {
    setPath('/?help=getting-started');
    syncWorkspaceUrl('demo', null);
    expect(window.location.pathname).toBe('/projects/demo');
    expect(window.location.search).toBe('?help=getting-started');
  });

  it('does not push when the path already matches', () => {
    setPath('/projects/demo');
    const before = window.history.length;
    syncWorkspaceUrl('demo', null);
    expect(window.history.length).toBe(before);
  });
});
