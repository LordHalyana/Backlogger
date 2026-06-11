// Chapter registry for the Help drawer.
//
// Markdown files are bundled at build time via Vite's `import.meta.glob` so
// the help content ships as a string constant — no runtime fetch, no
// network, no server round-trip.

export interface HelpChapter {
  slug: string;
  title: string;
  order: number;
  body: string;
}

interface RawFrontmatter {
  slug?: string;
  title?: string;
  order?: number;
}

// Vite-only API: returns a record of relative path → raw file contents.
// `eager: true` inlines everything at build time.
const modules = import.meta.glob('../help/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export function parseFrontmatter(source: string): { fm: RawFrontmatter; body: string } {
  // Minimal YAML-ish parser: the help files only use string and number scalars.
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
    return { fm: {}, body: source };
  }
  const start = source.startsWith('---\r\n') ? 5 : 4;
  const end = source.search(/\r?\n---/);
  if (end === -1) return { fm: {}, body: source };
  const block = source.slice(start, end);
  const marker = source.slice(end).match(/^\r?\n---\r?\n?/);
  const body = source.slice(end + (marker?.[0].length ?? 4));
  const fm: RawFrontmatter = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (key === undefined || rawValue === undefined) continue;
    let value: string | number = rawValue.trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (/^-?\d+$/.test(value)) {
      value = Number(value);
    }
    (fm as Record<string, string | number>)[key] = value;
  }
  return { fm, body };
}

function buildChapters(): HelpChapter[] {
  const chapters: HelpChapter[] = [];
  for (const [path, raw] of Object.entries(modules)) {
    const { fm, body } = parseFrontmatter(raw);
    if (!fm.slug || !fm.title || typeof fm.order !== 'number') {
      throw new Error(`Help chapter ${path} is missing slug/title/order frontmatter`);
    }
    chapters.push({ slug: fm.slug, title: fm.title, order: fm.order, body });
  }
  chapters.sort((a, b) => a.order - b.order);
  return chapters;
}

export const HELP_CHAPTERS: readonly HelpChapter[] = buildChapters();

export function findChapter(slug: string | null | undefined): HelpChapter | null {
  if (!slug) return null;
  return HELP_CHAPTERS.find((c) => c.slug === slug) ?? null;
}
