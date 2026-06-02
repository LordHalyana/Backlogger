---
template_id: docs-template
template_name: Docs & Links Guide
type: note
---

# {{title}}

> Project: {{project}}
> Created: {{date}}

---

## How Documents Work

Each document lives inside a **project**. A project maps to a folder on disk:

```
data/
└── projects/
    └── <project-id>/
        ├── <document-slug>.md     ← document body (Markdown)
        └── ...
```

Documents have a **title**, a **type**, optional **tags**, and a **body** written in
Markdown. All metadata (title, type, status, tags) is stored in the database; the body
is the `.md` file on disk. The two are always kept in sync — edits autosave to both.

---

## Wiki-style Links

Link to another document by wrapping its **exact title** in double brackets:

```
[[Document Title]]
```

- The link **resolves** when a document with that title exists in the same project.
- Resolved links appear in the target document's **Backlinks** panel (sidebar metadata).
- Unresolved links (targets that don't exist yet) appear as **red broken-link nodes**
  in the Knowledge Graph — a useful way to spot gaps in your documentation.
- Link display text can differ from the title:

  ```
  [[Actual Title|Display Text]]
  ```

---

## Tags

Add tags in the metadata panel (comma- or Enter-separated). Tags are project-scoped.
Click a tag in the sidebar to filter the document tree; multiple tags use **AND**
semantics. Active tags show as chips above the tree with individual remove buttons.

---

## Folder Structure (Document Tree)

Documents can be organised into **nested folders** in the project tree. Folders are
virtual — they exist as a path prefix on the document's title and are stored in the
database, not on disk.

Typical project folder layout:

```
My Project
├── 📁 design/
│   ├── overview.md
│   └── roadmap.md
├── 📁 phases/
│   ├── 📁 phase-1/
│   │   ├── implementation-plan.md
│   │   └── 📁 blocks/
│   │       ├── block-1.md
│   │       └── block-2.md
│   └── 📁 phase-2/
│       └── implementation-plan.md
├── 📁 reports/
│   └── 2026-06-01-status.md
├── 📁 archived/            ← mirror of the structure above
│   ├── 📁 design/
│   │   └── old-approach.md
│   └── 📁 phases/
│       └── 📁 phase-1/
│           └── scrapped-block.md
└── README.md
```

Create folders via the **+ New** dialog (include a `/` in the title, e.g.
`design/overview`) or right-click an existing document and choose **Move to folder**.

### The `archived/` folder

The `archived/` folder is automatically managed by the app. When a document's status
is set to **archived** (via the **Archive** button in the metadata panel), the file is
physically moved to `archived/<original-folder>/<filename>.md` on disk — preserving
the full folder hierarchy under the archive root.

Clicking **Unarchive** reverses the move, restoring the file to its original location.

---

## Knowledge Graph

Click **Graph** in the topbar to open the interactive canvas overlay:

- **Nodes** = documents (coloured by type) + broken-link sinks (red).
- **Edges** = wiki-links (directed, source → target).
- **Node size** scales with in-degree (more backlinks → larger node).
- **Filter bar** — type any word to show only matching nodes and their direct neighbours.
- **Hover** highlights a node's neighbourhood; all other nodes fade.
- **Click** a node to open that document and close the graph.
- **Esc** closes the overlay without navigating.

---

## Document Types

| Type | Purpose |
|------|---------|
| `note` | General freeform notes, ideas, scratch-pad |
| `design_doc` | Architecture and design decisions |
| `implementation_plan` | Phased build plans with tasks and exit criteria |
| `findings` | Research findings, investigation reports |
| `risk_assessment` | Risk registers |
| `backlog_item` | Individual backlog entries |

The type controls which built-in template is offered in the **New Document** dialog
and how the node is coloured in the Knowledge Graph.

---

## Templates

Two categories:

1. **Built-in templates** — shipped with Backlogger (`packages/api/templates/`).
   Available to all projects automatically.

2. **User templates** — drop a `.md` file with this frontmatter into `data/templates/`:

   ```yaml
   ---
   template_id: my-template
   template_name: My Template
   type: note
   ---
   # {{title}}
   ...
   ```

   Then open **Settings → Reload** (no restart needed). The template appears in the
   New Document dialog with a "user" badge.

Available `{{placeholders}}`:

| Placeholder | Value |
|-------------|-------|
| `{{title}}` | Document title as entered |
| `{{project}}` | Project ID |
| `{{date}}` | ISO date of creation (`YYYY-MM-DD`) |

---

## Suggested Naming Conventions

| Pattern | Example |
|---------|---------|
| Phase plans | `phases/phase-N/implementation-plan` |
| Block designs | `phases/phase-N/blocks/block-N-short-name` |
| Status reports | `reports/YYYY-MM-DD-topic` |
| Design decisions | `design/decision-short-name` |
| Backlog items | `backlog/YYYY-MM-DD-short-description` |

Consistent naming makes the Knowledge Graph readable at a glance and keeps
full-text search results easy to scan.
