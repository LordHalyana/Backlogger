import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown.js';

describe('markdown renderer security', () => {
  it('strips <script> tags from rendered output', () => {
    const input = 'Hello <script>alert("xss")</script> world';
    const output = renderMarkdown(input);
    // html: false escapes the tag — it must not appear as a live <script> element.
    expect(output).not.toContain('<script>');
    // It is rendered as escaped text instead.
    expect(output).toContain('&lt;script&gt;');
  });

  it('strips inline event handlers from rendered output', () => {
    const input = '<img src=x onerror="alert(1)">';
    const output = renderMarkdown(input);
    // html: false escapes the <img> tag — the onerror handler cannot fire.
    expect(output).not.toContain('<img');
  });

  it('strips raw HTML when html option is disabled', () => {
    const input = '<b>bold</b> and <em>italic</em> via raw html';
    const output = renderMarkdown(input);
    // Raw HTML tags should be escaped, not passed through literally.
    expect(output).not.toMatch(/<b>/);
    expect(output).toContain('&lt;b&gt;');
  });

  it('renders safe Markdown correctly', () => {
    const input = '**bold** and _italic_';
    const output = renderMarkdown(input);
    expect(output).toContain('<strong>bold</strong>');
    expect(output).toContain('<em>italic</em>');
  });
});
