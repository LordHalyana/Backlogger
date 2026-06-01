---
slug: search
title: Search
order: 4
---

# Search

Backlogger ships with a full-text index built on SQLite FTS5. Open the
**Command Palette** with `Ctrl+K` (or `⌘+K` on macOS) and start typing.

## Query syntax

- Plain words: `sprint planning` matches documents containing either word.
- Phrases: `"sprint planning"` matches the exact phrase.
- Prefix: `back*` matches `backlog`, `backlink`, etc.
- Exclude: `sprint -done` excludes documents containing `done`.

Results are ranked by FTS5 BM25; the snippet shows the first match in
context.

## Scope

- Search is always scoped to the **currently selected project**.
- Hidden frontmatter is **not** indexed; titles, tags, and body are.

## Keyboard

- `Ctrl+K` / `⌘+K` — open palette.
- `↑` / `↓` — navigate results.
- `Enter` — open the highlighted result.
- `Esc` — close the palette.

See also: **Tags**, **Wiki Links**.
