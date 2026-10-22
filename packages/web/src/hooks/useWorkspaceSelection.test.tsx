import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DialogProvider } from '../lib/dialog.js';
import { useBlockLeave } from '../lib/leave-guard.js';
import { historyIndex } from '../lib/workspace-url.js';
import { useWorkspaceSelection, type WorkspaceSelection } from './useWorkspaceSelection.js';

/**
 * The leave prompt through the real workspace navigations: each one asks
 * Stay / Discard and leave while the open task has an unsaved comment.
 */

let selection: WorkspaceSelection;

function Workspace({ draft }: { draft: boolean }): JSX.Element {
  selection = useWorkspaceSelection();
  return (
    <>
      <span data-testid="url">{`${selection.projectId}/${selection.view}/${selection.documentId}/${selection.triage}`}</span>
      <span data-testid="recovery">{JSON.stringify(selection.recovery)}</span>
      {selection.documentId && <Draft key={selection.documentId} active={draft} />}
    </>
  );
}

/** Stands in for the Comments tab: unsaved work owned by the open task. */
function Draft({ active }: { active: boolean }): null {
  useBlockLeave(active);
  return null;
}

function renderAt(path: string, draft = true): void {
  window.history.replaceState(null, '', path);
  render(
    <DialogProvider>
      <Workspace draft={draft} />
    </DialogProvider>,
  );
}

const shown = (): string => screen.getByTestId('url').textContent ?? '';

async function answer(label: 'Stay' | 'Discard and leave'): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: label }));
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
});

describe('leaving a task with an unsaved comment', () => {
  const navigations: [string, () => void, string][] = [
    ['tree', () => selection.selectTreeDocument('t2'), 'p/documents/t2/false'],
    ['palette', () => selection.openDocument('q', 't3'), 'q/documents/t3/false'],
    ['project switch', () => selection.selectProject('q'), 'q/documents/null/false'],
    ['view switch', () => selection.selectView('board'), 'p/board/null/false'],
    ['triage', () => selection.openTriage(), 'null/documents/null/true'],
  ];

  it.each(navigations)('%s asks, and Stay keeps the task', async (_name, go) => {
    renderAt('/projects/p/documents/t1');
    act(go);
    await answer('Stay');
    expect(shown()).toBe('p/documents/t1/false');
    expect(window.location.pathname).toBe('/projects/p/documents/t1');
  });

  it.each(navigations)('%s asks, and Discard and leave goes', async (_name, go, target) => {
    renderAt('/projects/p/documents/t1');
    act(go);
    await answer('Discard and leave');
    expect(shown()).toBe(target);
  });

  it('does not ask without unsaved work', () => {
    renderAt('/projects/p/documents/t1', false);
    act(() => selection.selectTreeDocument('t2'));
    expect(shown()).toBe('p/documents/t2/false');
    expect(screen.queryByRole('button', { name: 'Stay' })).toBeNull();
  });

  it('does not ask when staying on the same task', () => {
    renderAt('/projects/p/documents/t1');
    act(() => selection.selectDocument('t1'));
    expect(screen.queryByRole('button', { name: 'Stay' })).toBeNull();
  });

  it('asks again for a new draft after discarding one', async () => {
    renderAt('/projects/p/documents/t1');
    act(() => selection.selectTreeDocument('t2'));
    await answer('Discard and leave');
    expect(shown()).toBe('p/documents/t2/false');
    act(() => selection.selectTreeDocument('t3'));
    await answer('Stay');
    expect(shown()).toBe('p/documents/t2/false');
  });

  it('Stay after Back returns to the task and keeps forward history', async () => {
    // History: project → task → board, then Back to the task. The board
    // entry is the forward history Stay must keep.
    renderAt('/projects/p');
    act(() => selection.selectTreeDocument('t1'));
    act(() => selection.selectView('board'));
    await answer('Discard and leave');
    await waitFor(() => expect(window.location.pathname).toBe('/projects/p/board'));
    act(() => window.history.back());
    await waitFor(() => expect(shown()).toBe('p/documents/t1/false'));
    const taskIndex = historyIndex();

    act(() => window.history.back());
    await answer('Stay');
    await waitFor(() => expect(window.location.pathname).toBe('/projects/p/documents/t1'));
    expect(historyIndex()).toBe(taskIndex);
    expect(shown()).toBe('p/documents/t1/false');

    act(() => window.history.forward());
    await answer('Discard and leave');
    await waitFor(() => expect(shown()).toBe('p/board/null/false'));
    expect(window.location.pathname).toBe('/projects/p/board');
  });
});

describe('landing on a comment', () => {
  it('a comment link lands on its comment; leaving the task drops the landing', () => {
    renderAt('/projects/p/documents/t1/comments/c1', false);
    expect(selection.landing).toMatchObject({ kind: 'comment', commentId: 'c1', terms: [] });
    act(() => selection.selectTreeDocument('t2'));
    expect(selection.landing).toBeNull();
    expect(window.location.pathname).toBe('/projects/p/documents/t2');
  });

  it('opening a comment result puts the comment in the URL, with a new landing each time', () => {
    renderAt('/', false);
    act(() =>
      selection.openDocument('q', 't3', { kind: 'comment', commentId: 'c9', terms: ['zebra'] }),
    );
    expect(window.location.pathname).toBe('/projects/q/documents/t3/comments/c9');
    const first = selection.landing;
    expect(first).toMatchObject({ kind: 'comment', commentId: 'c9', terms: ['zebra'] });
    act(() =>
      selection.openDocument('q', 't3', { kind: 'comment', commentId: 'c9', terms: ['zebra'] }),
    );
    expect(selection.landing?.key).not.toBe(first?.key);
  });

  it('relocateProject follows a filed task without a new history entry, keeping the landing', () => {
    renderAt('/projects/old/documents/t1/comments/c1', false);
    const landing = selection.landing;
    const length = window.history.length;
    act(() => selection.relocateProject('new'));
    expect(shown()).toBe('new/documents/t1/false');
    expect(window.location.pathname).toBe('/projects/new/documents/t1/comments/c1');
    expect(window.history.length).toBe(length);
    expect(selection.landing).toBe(landing);
  });
});

describe('the Recovery page', () => {
  const recovery = (): string => screen.getByTestId('recovery').textContent ?? '';

  it('opens on an operation from the URL, selects others in place, and leaves for a task', () => {
    renderAt('/recovery/op-1', false);
    expect(recovery()).toBe('{"operationId":"op-1"}');
    expect(shown()).toBe('null/documents/null/false');
    const entry = historyIndex();
    act(() => selection.selectRecoveryOperation('op-2'));
    expect(window.location.pathname).toBe('/recovery/op-2');
    expect(historyIndex()).toBe(entry);
    act(() => selection.openDocument('p', 't1'));
    expect(recovery()).toBe('null');
    expect(window.location.pathname).toBe('/projects/p/documents/t1');
  });

  it('is reached from a task, and Back returns to it', async () => {
    renderAt('/projects/p/documents/t1', false);
    act(() => selection.openRecovery('op-1'));
    expect(window.location.pathname).toBe('/recovery/op-1');
    expect(recovery()).toBe('{"operationId":"op-1"}');
    act(() => window.history.back());
    await waitFor(() => expect(shown()).toBe('p/documents/t1/false'));
    expect(recovery()).toBe('null');
  });
});
