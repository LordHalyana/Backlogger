import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from './index.js';

describe('help frontmatter parser', () => {
  it('parses LF frontmatter', () => {
    const parsed = parseFrontmatter('---\nslug: intro\ntitle: Intro\norder: 1\n---\n# Intro\n');

    expect(parsed.fm).toEqual({ slug: 'intro', title: 'Intro', order: 1 });
    expect(parsed.body).toBe('# Intro\n');
  });

  it('parses CRLF frontmatter', () => {
    const parsed = parseFrontmatter(
      '---\r\nslug: import-export\r\ntitle: Import & Export\r\norder: 7\r\n---\r\n# Import\r\n',
    );

    expect(parsed.fm).toEqual({
      slug: 'import-export',
      title: 'Import & Export',
      order: 7,
    });
    expect(parsed.body).toBe('# Import\r\n');
  });
});
