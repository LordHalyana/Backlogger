import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HELP_CHAPTERS, findChapter } from '../help/index.js';
import { HelpDrawer } from './HelpDrawer.js';

afterEach(() => {
  cleanup();
  // Reset URL between tests.
  window.history.replaceState({}, '', '/');
});

describe('Help chapter registry', () => {
  it('loads all eight chapters in documented order', () => {
    const slugs = HELP_CHAPTERS.map((c) => c.slug);
    expect(slugs).toEqual([
      'markdown-basics',
      'wiki-links',
      'tags',
      'search',
      'templates',
      'projects',
      'import-export',
      'mounting-docs',
    ]);
  });

  it('findChapter resolves by slug and is null-safe', () => {
    expect(findChapter('tags')?.title).toBe('Tags');
    expect(findChapter('does-not-exist')).toBeNull();
    expect(findChapter(null)).toBeNull();
  });

  it('every chapter has non-empty body and unique order', () => {
    const orders = new Set<number>();
    for (const c of HELP_CHAPTERS) {
      expect(c.body.length).toBeGreaterThan(20);
      expect(orders.has(c.order)).toBe(false);
      orders.add(c.order);
    }
  });
});

describe('HelpDrawer', () => {
  it('renders the requested initial chapter and reflects it in the URL', () => {
    render(<HelpDrawer open initialSlug="tags" onClose={() => undefined} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Tags' })).toBeTruthy();
    expect(new URL(window.location.href).searchParams.get('help')).toBe('tags');
  });

  it('falls back to the first chapter when initialSlug is missing', () => {
    render(<HelpDrawer open initialSlug={null} onClose={() => undefined} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Markdown Basics' })).toBeTruthy();
  });

  it('navigating the chapter list swaps content and updates the URL', async () => {
    const user = userEvent.setup();
    render(<HelpDrawer open initialSlug={null} onClose={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Wiki Links' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Wiki Links' })).toBeTruthy();
    expect(new URL(window.location.href).searchParams.get('help')).toBe('wiki-links');
  });

  it('filter input narrows the chapter list', async () => {
    const user = userEvent.setup();
    render(<HelpDrawer open initialSlug={null} onClose={() => undefined} />);
    const search = screen.getByLabelText('Filter help chapters');
    await user.type(search, 'wiki');
    expect(screen.getByRole('button', { name: 'Wiki Links' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tags' })).toBeNull();
  });

  it('Esc invokes onClose', async () => {
    const onClose = vi.fn();
    render(<HelpDrawer open initialSlug={null} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <HelpDrawer open={false} initialSlug={null} onClose={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
