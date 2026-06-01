/**
 * `[[Title]]` and `[[Title|display]]` wiki-link parser.
 *
 * - Single-pass regex over the input body.
 * - Caps each segment to 200 chars to avoid pathological inputs.
 * - Disallows `[`, `]`, `|`, or newline inside the title or display segment.
 * - The `position` is the byte offset of the `[[` opener in the source string;
 *   the link service uses it as a stable ordering key when persisting rows.
 */
export interface WikiLink {
  /** Raw title text between `[[` and `]]` (or before the `|`), trimmed. */
  title: string;
  /** Human-facing label. Equals `title` when no `|alias` is present. */
  display: string;
  /** Byte offset of `[[` in the source. */
  position: number;
  /** Length of the entire `[[…]]` match in the source. */
  length: number;
}

const WIKI_LINK_RE = /\[\[([^[\]|\n]{1,200})(?:\|([^[\]\n]{1,200}))?\]\]/g;

export function parseWikiLinks(body: string): WikiLink[] {
  if (!body) return [];
  const out: WikiLink[] = [];
  WIKI_LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKI_LINK_RE.exec(body)) !== null) {
    const rawTitle = match[1] ?? '';
    const rawDisplay = match[2];
    const title = rawTitle.trim();
    if (!title) continue;
    const display = rawDisplay !== undefined ? rawDisplay.trim() || title : title;
    out.push({
      title,
      display,
      position: match.index,
      length: match[0].length,
    });
  }
  return out;
}

/** Normalize a title for case-insensitive lookup (lower-case + trim + collapse spaces). */
export function normalizeWikiTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}
