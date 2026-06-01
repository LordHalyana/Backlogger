---
slug: templates
title: Templates
order: 5
---

# Templates

Templates are reusable starting points for new documents. They are also
just `.md` files, so you can author them in your editor of choice.

## Built-in vs user templates

- **Built-in** templates ship with Backlogger and cannot be deleted.
- **User** templates live under `templates/` in your data directory and
  override built-ins on id collision.

## File layout

```markdown
---
id: idea-expansion
type: note
name: Idea Expansion
---

# {{title}}

## Problem

## Hypothesis

## Next step
```

The frontmatter `id` must be unique. `type` constrains which document
kinds can use the template (e.g. `note`, `task`).

## Reloading

After editing a template file on disk, open **Settings** and click
**Reload** under *Templates*. The new template list takes effect
immediately for the **New Document** dialog.

## Variables

Currently supported: `{{title}}`. More variables will arrive in a later
phase — for now anything else is left as literal text.

See also: **Projects**.
