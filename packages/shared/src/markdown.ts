import MarkdownIt from 'markdown-it';
import { parseWikiLinks } from './wiki-link.js';

type StateInline = Parameters<Parameters<MarkdownIt['inline']['ruler']['before']>[2]>[0];

// Single shared markdown-it instance configured for both server and client.
// Phase 1: GitHub-style line breaks, autolinks, HTML disabled for safety.
// Phase 2: wiki-link inline rule emits `<a class="wiki-link" data-title="…">`.
//
// SECURITY: html must remain false to prevent XSS via dangerouslySetInnerHTML.
// See packages/web/src/components/DocumentPreview.tsx and HelpDrawer.tsx.
// Do not enable raw HTML without a sanitization pass (e.g., DOMPurify).
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
});

md.inline.ruler.before('emphasis', 'wiki_link', wikiLinkRule);
md.renderer.rules['wiki_link_open'] = (tokens, idx) => {
  const token = tokens[idx]!;
  const title = token.attrGet('title') ?? '';
  return `<a class="wiki-link" data-title="${escapeHtml(title)}" href="#">`;
};
md.renderer.rules['wiki_link_close'] = () => '</a>';

export function renderMarkdown(source: string): string {
  return md.render(source ?? '');
}

/**
 * Inline rule that recognises `[[Title]]` and `[[Title|display]]` and emits
 * `wiki_link_open` / `text` / `wiki_link_close` tokens. We delegate the
 * actual matching to the shared `parseWikiLinks` helper so the rule and
 * the persisted link index stay in lock-step.
 */
function wikiLinkRule(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x5b /* [ */) return false;
  if (state.src.charCodeAt(state.pos + 1) !== 0x5b) return false;

  // Limit the scan window so the rule is O(local) instead of O(document).
  const slice = state.src.slice(state.pos, state.pos + 250);
  const links = parseWikiLinks(slice);
  const link = links[0];
  if (!link || link.position !== 0) return false;

  if (!silent) {
    const open = state.push('wiki_link_open', 'a', 1);
    open.attrSet('title', link.title);
    const text = state.push('text', '', 0);
    text.content = link.display;
    state.push('wiki_link_close', 'a', -1);
  }

  state.pos += link.length;
  return true;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
