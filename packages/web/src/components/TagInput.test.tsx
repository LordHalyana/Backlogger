import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TagInput } from './TagInput.js';

afterEach(cleanup);

describe('TagInput', () => {
  it('renders existing tags as chips', () => {
    render(<TagInput value={['alpha', 'beta']} onChange={vi.fn()} />);
    expect(screen.getByText('alpha')).toBeTruthy();
    expect(screen.getByText('beta')).toBeTruthy();
  });

  it('commits a valid tag on Enter', async () => {
    const onChange = vi.fn();
    render(<TagInput value={['alpha']} onChange={onChange} />);
    await userEvent.type(screen.getByPlaceholderText('Add tag…'), 'beta{Enter}');
    expect(onChange).toHaveBeenCalledWith(['alpha', 'beta']);
  });

  it('shows a validation error for an invalid tag and does not commit', async () => {
    const onChange = vi.fn();
    render(<TagInput value={[]} onChange={onChange} />);
    await userEvent.type(screen.getByPlaceholderText('Add tag…'), 'Bad Tag!{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/tag/i)).toBeTruthy();
  });

  it('removes a tag via its chip', async () => {
    const onChange = vi.fn();
    render(<TagInput value={['alpha', 'beta']} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove tag alpha' }));
    expect(onChange).toHaveBeenCalledWith(['beta']);
  });
});
