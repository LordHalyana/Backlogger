import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useDialog, DialogProvider, errorToastMessage } from './dialog.js';

function ConfirmHarness({ onResult }: { onResult: (v: boolean) => void }): JSX.Element {
  const dialog = useDialog();
  return (
    <button
      type="button"
      onClick={() => {
        void dialog
          .confirm({
            title: 'Delete?',
            message: 'Really?',
            confirmLabel: 'Yes',
            danger: true,
          })
          .then(onResult);
      }}
    >
      open
    </button>
  );
}

function AlertHarness({ onResult }: { onResult: () => void }): JSX.Element {
  const dialog = useDialog();
  return (
    <button
      type="button"
      onClick={() => {
        void dialog
          .alert({
            title: 'Skipped files',
            message: '- docs/bad.md: project/folder mismatch',
          })
          .then(onResult);
      }}
    >
      open
    </button>
  );
}

function PromptHarness({ onResult }: { onResult: (v: string | null) => void }): JSX.Element {
  const dialog = useDialog();
  return (
    <button
      type="button"
      onClick={() => {
        void dialog
          .prompt({
            title: 'Type',
            message: 'Type something',
            defaultValue: 'seed',
            validate: (v) => (v.length < 3 ? 'too short' : null),
          })
          .then(onResult);
      }}
    >
      open
    </button>
  );
}

afterEach(() => cleanup());

describe('DialogProvider', () => {
  it('formats error toast messages consistently', () => {
    expect(errorToastMessage('Reload failed', new Error('disk unavailable'))).toBe(
      'Reload failed: disk unavailable',
    );
    expect(errorToastMessage('Reindex failed', 'unknown failure')).toBe(
      'Reindex failed: unknown failure',
    );
  });

  it('alert shows message and resolves on OK', async () => {
    const user = userEvent.setup();
    let resolved = false;
    render(
      <DialogProvider>
        <AlertHarness onResult={() => { resolved = true; }} />
      </DialogProvider>,
    );

    await user.click(screen.getByText('open'));
    expect(await screen.findByText('- docs/bad.md: project/folder mismatch')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(resolved).toBe(true));
  });

  it('confirm resolves true when Yes is clicked', async () => {
    const user = userEvent.setup();
    const results: boolean[] = [];
    render(
      <DialogProvider>
        <ConfirmHarness onResult={(v) => results.push(v)} />
      </DialogProvider>,
    );

    await user.click(screen.getByText('open'));
    await user.click(await screen.findByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(results).toEqual([true]));
  });

  it('confirm resolves false on Escape', async () => {
    const user = userEvent.setup();
    const results: boolean[] = [];
    render(
      <DialogProvider>
        <ConfirmHarness onResult={(v) => results.push(v)} />
      </DialogProvider>,
    );

    await user.click(screen.getByText('open'));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(results).toEqual([false]));
  });

  it('prompt blocks submit when validate returns an error', async () => {
    const user = userEvent.setup();
    const results: Array<string | null> = [];
    render(
      <DialogProvider>
        <PromptHarness onResult={(v) => results.push(v)} />
      </DialogProvider>,
    );

    await user.click(screen.getByText('open'));
    const input = await screen.findByDisplayValue('seed');
    await user.clear(input);
    await user.type(input, 'no');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('too short')).toBeTruthy();
    expect(results).toEqual([]);

    await user.clear(input);
    await user.type(input, 'yesplease');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(results).toEqual(['yesplease']));
  });
});
