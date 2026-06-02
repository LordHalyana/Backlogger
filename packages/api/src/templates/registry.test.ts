import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyPlaceholders,
  defaultTemplatesDir,
  loadAllTemplates,
  loadTemplatesFromDir,
  TemplateRegistry,
} from './registry.js';

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'templates',
);

describe('applyPlaceholders', () => {
  it('replaces title, project, date', () => {
    const out = applyPlaceholders('# {{title}}\nproject {{project}} on {{date}}', {
      title: 'Hello',
      project: 'aa',
      date: new Date('2026-03-04T12:00:00Z'),
    });
    // Date uses local time; just assert the YYYY-MM-DD shape and the other tokens.
    expect(out).toMatch(/^# Hello\nproject aa on \d{4}-\d{2}-\d{2}$/);
  });

  it('leaves unknown placeholders untouched', () => {
    expect(applyPlaceholders('{{title}} {{unknown}}', { title: 'A', project: 'b' })).toBe(
      'A {{unknown}}',
    );
  });
});

describe('loadTemplatesFromDir', () => {
  it('finds the built-in default dir', () => {
    expect(defaultTemplatesDir()).toContain('packages/api/templates');
  });

  it('loads all six built-in templates', async () => {
    const { loaded, skipped } = await loadTemplatesFromDir(TEMPLATES_DIR);
    expect(skipped).toEqual([]);
    const ids = loaded.map((t) => t.id).sort();
    expect(ids).toEqual(
      [
        'design-document',
        'docs-template',
        'findings-report',
        'idea-expansion',
        'implementation-plan',
        'risk-assessment',
      ].sort(),
    );
  });

  it('sets source to builtin by default', async () => {
    const { loaded } = await loadTemplatesFromDir(TEMPLATES_DIR);
    expect(loaded.every((t) => t.source === 'builtin')).toBe(true);
  });

  it('sets source to user when specified', async () => {
    const { loaded } = await loadTemplatesFromDir(TEMPLATES_DIR, { source: 'user' });
    expect(loaded.every((t) => t.source === 'user')).toBe(true);
  });
});

describe('loadAllTemplates', () => {
  it('merges builtin and user templates', async () => {
    const userDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bl-tmpl-test-'));
    try {
      // write a custom user template
      const frontmatter =
        '---\ntemplate_id: my-custom\ntemplate_name: My Custom\ntype: note\n---\n# Custom body';
      await fs.writeFile(path.join(userDir, 'my-custom.md'), frontmatter);

      const { loaded } = await loadAllTemplates(TEMPLATES_DIR, userDir);
      const ids = loaded.map((t) => t.id);
      expect(ids).toContain('my-custom');
      expect(ids).toContain('idea-expansion');

      const custom = loaded.find((t) => t.id === 'my-custom')!;
      expect(custom.source).toBe('user');

      const builtin = loaded.find((t) => t.id === 'idea-expansion')!;
      expect(builtin.source).toBe('builtin');
    } finally {
      await fs.rm(userDir, { recursive: true, force: true });
    }
  });

  it('user template overrides builtin on id collision', async () => {
    const userDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bl-tmpl-collision-'));
    try {
      // write a user template with same id as a builtin
      const frontmatter =
        '---\ntemplate_id: idea-expansion\ntemplate_name: My Idea Expansion\ntype: idea\n---\n# User version';
      await fs.writeFile(path.join(userDir, 'idea-expansion.md'), frontmatter);

      const { loaded } = await loadAllTemplates(TEMPLATES_DIR, userDir);
      const matches = loaded.filter((t) => t.id === 'idea-expansion');
      expect(matches).toHaveLength(1);
      const match = matches[0];
      expect(match?.source).toBe('user');
      expect(match?.name).toBe('My Idea Expansion');
    } finally {
      await fs.rm(userDir, { recursive: true, force: true });
    }
  });
});

describe('TemplateRegistry', () => {
  it('lists templates sorted by name and returns by id', () => {
    const reg = new TemplateRegistry();
    reg.setAll([
      { id: 'b', name: 'Bravo', type: 'note', source: 'builtin', body: '' },
      { id: 'a', name: 'Alpha', type: 'note', source: 'builtin', body: 'x' },
    ]);
    expect(reg.list().map((t) => t.id)).toEqual(['a', 'b']);
    expect(reg.get('a')?.body).toBe('x');
    expect(reg.get('missing')).toBeUndefined();
    expect(() => reg.getOrThrow('missing')).toThrow(/Template not found/);
  });
});
