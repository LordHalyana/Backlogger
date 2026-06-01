---
slug: projects
title: Projects
order: 6
---

# Projects

A **project** is the unit of isolation in Backlogger. Each project has its
own:

- folder on disk under `data/projects/<id>/`,
- title and tag index,
- backlink graph,
- search scope.

Documents do not cross project boundaries; wiki-links resolve only inside
the current project.

## Creating

Click **+ New Project** in the topbar. The **id** is the on-disk folder
name and must be URL-safe (lowercase letters, digits, and hyphens). The
**name** is the human label shown in the switcher.

## Switching

Use the project dropdown in the topbar. Switching clears the current
document selection and any active tag filters.

## Reloading from disk

If you edit files outside Backlogger (e.g. with `vim` or a sync tool),
click the topbar **Reload** button. Backlogger walks the project folder,
detects added / updated / removed files, and refreshes the in-memory
indexes. A toast confirms the counts.

## Deleting

Project deletion is not exposed in the UI for safety. Remove the project
folder on disk and click **Reload**, or use the API.

See also: **Import & Export**, **Templates**.
