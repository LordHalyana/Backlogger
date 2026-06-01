---
slug: markdown-basics
title: Markdown Basics
order: 1
---

# Markdown Basics

Backlogger documents are plain Markdown stored as `.md` files on disk. The
preview pane uses the same renderer the server uses for search snippets,
so what you write is what other tools (and other humans) see.

## Headings

```markdown
# H1 — document title
## H2 — section
### H3 — subsection
```

## Emphasis

```markdown
*italic* or _italic_
**bold** or __bold__
~~strike~~
```

## Lists

```markdown
- bullet
- bullet
  - nested

1. ordered
2. ordered
```

## Code

Inline: `` `like this` ``.

Fenced:

````markdown
```ts
const x: number = 1;
```
````

## Links

```markdown
[label](https://example.com)
```

Bare URLs are auto-linked.

## Quotes and rules

```markdown
> A blockquote.

---
```

## What's intentionally excluded

- Raw HTML is disabled in normal documents (allowed only in help content).
- Tables are supported via standard Markdown pipe syntax.

See also: **Wiki Links**, **Tags**.
