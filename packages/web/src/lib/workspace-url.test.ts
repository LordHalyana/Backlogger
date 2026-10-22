import { describe, it, expect, beforeEach } from 'vitest';
import {
  readCommentFromUrl,
  readRecoveryFromUrl,
  recoveryPathname,
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
    expect(readWorkspaceFromUrl()).toEqual({ projectId: null, documentId: null, view: 'documents' });
  });

  it('reads a project-only path', () => {
    setPath('/projects/demo');
    expect(readWorkspaceFromUrl()).toEqual({ projectId: 'demo', documentId: null, view: 'documents' });
  });

  it('reads a project + document path', () => {
    setPath('/projects/demo/documents/doc-1');
    expect(readWorkspaceFromUrl()).toEqual({ projectId: 'demo', documentId: 'doc-1', view: 'documents' });
  });

  it('decodes encoded segments', () => {
    setPath('/projects/a%20b/documents/c%2Fd');
    expect(readWorkspaceFromUrl()).toEqual({ projectId: 'a b', documentId: 'c/d', view: 'documents' });
  });

  it('ignores unrelated paths', () => {
    setPath('/something/else');
    expect(readWorkspaceFromUrl()).toEqual({ projectId: null, documentId: null, view: 'documents' });
  });

  it('round-trips with workspacePathname', () => {
    setPath(workspacePathname('demo', 'doc-1'));
    expect(readWorkspaceFromUrl()).toEqual({ projectId: 'demo', documentId: 'doc-1', view: 'documents' });
  });
});

describe('board view URLs', () => {
  it('builds the board path and the board-opened document path', () => {
    expect(workspacePathname('demo', null, 'board')).toBe('/projects/demo/board');
    expect(workspacePathname('demo', 'doc-1', 'board')).toBe(
      '/projects/demo/board/documents/doc-1',
    );
  });

  it('reads the board path', () => {
    setPath('/projects/demo/board');
    expect(readWorkspaceFromUrl()).toEqual({ projectId: 'demo', documentId: null, view: 'board' });
  });

  it('reads a document opened from the board', () => {
    setPath('/projects/demo/board/documents/doc-1');
    expect(readWorkspaceFromUrl()).toEqual({
      projectId: 'demo',
      documentId: 'doc-1',
      view: 'board',
    });
  });

  it('syncs the board view into the path', () => {
    setPath('/projects/demo');
    syncWorkspaceUrl('demo', null, 'board');
    expect(window.location.pathname).toBe('/projects/demo/board');
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

describe('comment links', () => {
  it('builds and reads /projects/:projectId/documents/:documentId/comments/:commentId', () => {
    const path = workspacePathname('demo', 'doc-1', 'documents', 'c-1');
    expect(path).toBe('/projects/demo/documents/doc-1/comments/c-1');
    setPath(path);
    expect(readWorkspaceFromUrl()).toEqual({ projectId: 'demo', documentId: 'doc-1', view: 'documents' });
    expect(readCommentFromUrl()).toBe('c-1');
  });

  it('reads a comment of a document opened from the board', () => {
    setPath('/projects/demo/board/documents/doc-1/comments/c-1');
    expect(readWorkspaceFromUrl()).toEqual({ projectId: 'demo', documentId: 'doc-1', view: 'board' });
    expect(readCommentFromUrl()).toBe('c-1');
  });

  it('has no comment on other paths', () => {
    setPath('/projects/demo/documents/doc-1');
    expect(readCommentFromUrl()).toBeNull();
    expect(workspacePathname('demo', null, 'documents', 'c-1')).toBe('/projects/demo');
  });

  it('replaces the history entry when asked', () => {
    setPath('/projects/old/documents/doc-1/comments/c-1');
    const before = window.history.length;
    syncWorkspaceUrl('new', 'doc-1', 'documents', false, { commentId: 'c-1', replace: true });
    expect(window.location.pathname).toBe('/projects/new/documents/doc-1/comments/c-1');
    expect(window.history.length).toBe(before);
  });
});

describe('the Recovery page', () => {
  it('reads /recovery and /recovery/:operationId', () => {
    setPath('/recovery');
    expect(readRecoveryFromUrl()).toEqual({ operationId: null });
    setPath('/recovery/4b1e0c9a-77d2-4f0e-9a51-3c2d8e6f1a20');
    expect(readRecoveryFromUrl()).toEqual({
      operationId: '4b1e0c9a-77d2-4f0e-9a51-3c2d8e6f1a20',
    });
    setPath('/projects/demo');
    expect(readRecoveryFromUrl()).toBeNull();
  });

  it('builds its path', () => {
    expect(recoveryPathname(null)).toBe('/recovery');
    expect(recoveryPathname('abc')).toBe('/recovery/abc');
  });
});
