import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SegmentedControl } from './SegmentedControl.js';

const OPTIONS = [
  { value: 'edit', label: 'Edit' },
  { value: 'split', label: 'Split' },
  { value: 'preview', label: 'Preview' },
] as const;

afterEach(cleanup);

describe('SegmentedControl', () => {
  it('marks the active option with aria-pressed', () => {
    render(
      <SegmentedControl ariaLabel="View mode" value="split" options={OPTIONS} onChange={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Split' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Edit' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('calls onChange with the clicked option value', async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl ariaLabel="View mode" value="split" options={OPTIONS} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(onChange).toHaveBeenCalledWith('preview');
  });

  it('moves the selection with arrow keys', async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl ariaLabel="View mode" value="split" options={OPTIONS} onChange={onChange} />,
    );
    screen.getByRole('button', { name: 'Split' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('preview');
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('edit');
  });

  it('wraps around at the ends', async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl ariaLabel="View mode" value="edit" options={OPTIONS} onChange={onChange} />,
    );
    screen.getByRole('button', { name: 'Edit' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('preview');
  });
});
