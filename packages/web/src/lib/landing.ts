/**
 * Where opening a document should land (spec #58, decision #60): on one
 * comment, from a Comment match or a direct comment link, or on the matching
 * paragraph of the description, from a Description match. `terms` are the
 * search query's words to highlight; a direct link has none. `key` tells
 * repeated landings on the same target apart.
 */
export type Landing =
  | { kind: 'comment'; commentId: string; terms: string[]; key: number }
  | { kind: 'description'; terms: string[]; key: number };

/** A landing before it is given its key. */
export type LandingTarget =
  | { kind: 'comment'; commentId: string; terms: string[] }
  | { kind: 'description'; terms: string[] };

let lastKey = 0;

/** Give a landing target a key no earlier landing has. */
export function keyLanding(target: LandingTarget): Landing {
  lastKey += 1;
  return { ...target, key: lastKey };
}

/** A search query's words, without the punctuation the search ignores. */
export function queryTerms(query: string): string[] {
  return query
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_-]/gu, ''))
    .filter((t) => t !== '');
}

/** Whole words starting with one of `terms` (search matches prefixes), case-insensitive. */
function termPattern(terms: string[]): RegExp | null {
  if (terms.length === 0) return null;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join('|')})[\\p{L}\\p{N}_]*`, 'giu');
}

/** Wrap each word of `root`'s text that matches `terms` in a `<mark>`. */
export function markTerms(root: HTMLElement, terms: string[]): void {
  const pattern = termPattern(terms);
  if (!pattern) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.parentElement?.closest('mark, code, pre')) texts.push(n as Text);
  }
  for (const text of texts) {
    const value = text.data;
    const matches = [...value.matchAll(pattern)];
    if (matches.length === 0) continue;
    const frag = document.createDocumentFragment();
    let at = 0;
    for (const m of matches) {
      const start = m.index;
      if (start > at) frag.append(value.slice(at, start));
      const mark = document.createElement('mark');
      mark.textContent = m[0];
      frag.append(mark);
      at = start + m[0].length;
    }
    if (at < value.length) frag.append(value.slice(at));
    text.replaceWith(frag);
  }
}

/** Blocks of rendered Markdown a description match can point at. */
const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th';

/**
 * The first block of `root` whose text holds every term (else any term):
 * the paragraph a Description match lands on.
 */
export function findMatchingBlock(root: HTMLElement, terms: string[]): HTMLElement | null {
  const pattern = termPattern(terms);
  if (!pattern) return null;
  const blocks = [...root.querySelectorAll<HTMLElement>(BLOCKS)].filter(
    // The innermost block: a list item's own paragraph, not the item around it.
    (el) => !el.querySelector(BLOCKS),
  );
  const holds = (el: HTMLElement, term: string): boolean =>
    termPattern([term])!.test(el.textContent ?? '');
  return (
    blocks.find((el) => terms.every((t) => holds(el, t))) ??
    blocks.find((el) => terms.some((t) => holds(el, t))) ??
    null
  );
}
