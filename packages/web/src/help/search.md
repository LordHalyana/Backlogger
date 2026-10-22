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

## Opening a result

- A **Comment match** opens the task's Comments tab on that comment, centred
  and focused, with the search words highlighted and a **From search** marker
  until you open a comment or leave the task. An older comment opens with two
  comments either side: **Load older comments**, **Show newer comments** and
  **Jump to latest** page from there.
- A **Description match** opens the Description with the matching paragraph
  marked.
- Each comment has a link, `/projects/<project>/documents/<task>/comments/<comment>`,
  that lands the same way. It keeps working after the task is filed into
  another project.
- A deleted comment opens the newest comments with a notice; a deleted task
  says it is no longer available. Nothing is recreated.

## Keyboard

- `Ctrl+K` / `⌘+K` — open palette.
- `↑` / `↓` — navigate results.
- `Enter` — open the highlighted result.
- `Esc` — close the palette.

See also: **Tags**, **Wiki Links**.
