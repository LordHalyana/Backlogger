---
slug: wiki-links
title: Wiki Links
order: 2
---

# Wiki Links

Use `[[Title]]` to link to another document by its title. Titles are
matched case-insensitively against the current project's documents.

```markdown
See [[Project Roadmap]] for the latest milestones.
```

## Aliased display

```markdown
Compare against the original [[Project Roadmap|roadmap]].
```

The text after `|` is what the reader sees; the resolution still uses the
title before the pipe.

## How resolution works

- Backlogger keeps a per-project title index, refreshed after every save.
- Clicking a wiki-link opens the target document.
- A link to a missing title is shown with a "broken" style until you create
  a document with that title.

## Backlinks

Open any document and look at the **Backlinks** panel: every other document
that links to the current one is listed there. Backlinks update on save.

See also: **Search**, **Tags**.
