import { describe, expect, it } from 'vitest';
import { normalizeWikiTitle, parseWikiLinks } from './wiki-link.js';

describe('parseWikiLinks', () => {
  it('returns nothing for empty/null input', () => {
    expect(parseWikiLinks('')).toEqual([]);
    expect(parseWikiLinks(undefined as unknown as string)).toEqual([]);
  });

  it('extracts a simple link', () => {
    const out = parseWikiLinks('See [[Other Doc]] for details.');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      title: 'Other Doc',
      display: 'Other Doc',
      position: 4,
      length: '[[Other Doc]]'.length,
    });
  });

  it('extracts an aliased link', () => {
    const out = parseWikiLinks('see [[Other Doc|here]]');
    expect(out[0]).toMatchObject({ title: 'Other Doc', display: 'here' });
  });

  it('extracts multiple links in document order', () => {
    const out = parseWikiLinks('a [[X]] b [[Y|why]] c [[Z]]');
    expect(out.map((l) => l.title)).toEqual(['X', 'Y', 'Z']);
    expect(out.map((l) => l.display)).toEqual(['X', 'why', 'Z']);
  });

  it('trims surrounding whitespace inside the title', () => {
    const out = parseWikiLinks('[[  Spaced Title  ]]');
    expect(out[0]).toMatchObject({ title: 'Spaced Title', display: 'Spaced Title' });
  });

  it('falls back to title when alias is empty/whitespace', () => {
    const out = parseWikiLinks('[[Title|   ]]');
    expect(out[0]).toMatchObject({ title: 'Title', display: 'Title' });
  });

  it('skips brackets without a closing pair', () => {
    expect(parseWikiLinks('[[Open')).toEqual([]);
    expect(parseWikiLinks('text]] tail')).toEqual([]);
  });

  it('rejects bracket / pipe / newline inside title', () => {
    expect(parseWikiLinks('[[Has [Bracket]]]')).toEqual([]);
    expect(parseWikiLinks('[[Has\nNewline]]')).toEqual([]);
  });

  it('caps very long titles', () => {
    const long = 'x'.repeat(201);
    expect(parseWikiLinks(`[[${long}]]`)).toEqual([]);
  });

  it('drops empty titles', () => {
    expect(parseWikiLinks('[[   ]]')).toEqual([]);
  });
});

describe('normalizeWikiTitle', () => {
  it('lowercases and trims', () => {
    expect(normalizeWikiTitle('  Foo BAR  ')).toBe('foo bar');
  });
  it('collapses internal whitespace', () => {
    expect(normalizeWikiTitle('foo   \t  bar')).toBe('foo bar');
  });
});
