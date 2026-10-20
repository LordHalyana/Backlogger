---
id: 1af7c02b-add4-4cec-8d6d-35801d5f3f10
title: Product Direction
project: backlogger-docs
type: design_doc
status: active
created_at: '2026-10-18T00:00:00.000Z'
updated_at: '2026-10-18T00:00:00.000Z'
tags: ["design", "roadmap"]
---

# Product Direction: Local Productivity Workspace

Source: *Local Productivity Workspace — concept whitepaper v0.1, 16 October 2026.*
Adopted as Backlogger's product direction on 18 October 2026.

This document restates the whitepaper and then maps it onto Backlogger as it
exists now. It sets **direction**, not requirements. Concrete behaviour is set by
Wayfinder decision tickets and specs in GitHub Issues (see
[Current roadmap](roadmap.md)). Where this document and an approved spec or
[CONTEXT.md](../../CONTEXT.md) disagree, the spec and the glossary win.

## Purpose

Backlogger is evolving from a Markdown documentation workspace into a locally
hosted productivity workspace. It brings projects, Kanban tickets, progress
notes, documentation and personal planning into one place. Durable content
stays in readable Markdown files, so it remains usable outside the app and
after the task is done.

The first release serves one person on their own computer. It needs no cloud
account or hosted control plane. A small plugin interface allows optional
dashboard integrations, with weather as the reference implementation. Team
collaboration and cloud management come in a later phase.

### Problem

Personal work gets scattered across task lists, notes, calendars and browser
tabs. A ticket may record that something was finished but not why a decision
was made or how it was done. Switching tools adds overhead and makes past work
hard to find.

### Outcome

A user can capture an idea with only a title, file it into a project, work from
a board or a Today view, reserve time for it, and leave a short completion
note. Search later finds the task together with its discussion and the
documentation it links to.

### Principles

- **Low friction.** Metadata is optional unless it is needed to keep records valid.
- **One record, multiple views.** Board, search, Today and calendar all reference the same tasks.
- **Local ownership.** Core workflows work offline, and data can be exported and restored.
- **Useful history.** Completed work stays searchable and linked to maintained documentation.
- **Progressive complexity.** Plugins and advanced planning never get in the way of basic task management.

## First local release

A single-user app with a local web interface. Personal projects share one
workspace. Tickets belong to the local user implicitly. Assigning work to other
people is reserved for team support.

| Capability | Initial behaviour |
|---|---|
| Capture and organize | Quick-capture inbox; create projects; move inbox items into a project. |
| Manage work | Kanban columns, ticket descriptions, checklists, labels, optional priority and due dates. |
| Preserve knowledge | Progress comments, linked Markdown documents, optional completion notes. |
| Find and review | Search titles and content; Today view; archive completed projects and tickets. |
| Plan time | Weekly planner with task-linked time blocks; deadlines and simple events. |
| Extend the dashboard | Fixed widget slots; enable/disable widgets; weather reference plugin. |
| Own the data | Readable files, index rebuild, workspace export, documented backup and restore. |

**Typical workflow.** Capture "Improve the registration form" in the inbox.
File it into a website project, add a short checklist, and link the existing
registration doc. Select it for Today and reserve a work block. Add findings as
progress notes during the work. When done, record the result and link the
updated doc. Archive the project once it is no longer active.

**Small, high-value additions.** A few built-in project presets instead of a
template editor. Optional completion notes with three prompts: what changed,
useful references, follow-up. Archive instead of forced deletion. A fixed
dashboard layout until real use shows a need to rearrange it.

**Outside the first release.** Team accounts, invitations, roles, hosted
infrastructure, billing, multi-device offline sync, public plugin marketplaces,
AI summaries, external calendar sync, complex recurrence and automation
builders. These are roadmap candidates, not hidden first-release requirements.

## Markdown as the durable record

Markdown is the authoritative format for productivity content. Tickets,
comments, documents and planner entries are Markdown files with YAML
frontmatter for metadata and a Markdown body for content. Project settings and
non-secret workspace preferences follow the same convention.

- Files are named by stable IDs, not mutable titles.
- Status is metadata, so moving a card between columns never moves its file.
- Human-readable keys may be displayed separately from IDs.
- Schema versions allow controlled migration.

The whitepaper's example layout (`workspaces/local/projects/<p>/tickets/<id>/ticket.md`,
`comments/comment_01.md`, `planner/block_01.md`) and its sample frontmatter are
**illustrative, not a migration mandate**. See
[How this maps onto Backlogger](#how-this-maps-onto-backlogger).

**Not in Markdown:** attachments keep their native formats. Credentials and keys
stay in protected operational storage, outside exports. Search indexes and
weather caches are disposable. SQLite holds the content index and operational
state; only the content index is assumed rebuildable from Markdown. Search
starts as text indexing. Embeddings and AI retrieval may come later but must
never be required for ordinary search.

## Local architecture and reliability

A TypeScript modular monolith: browser UI, one backend, SQLite, and a persistent
local data directory, packaged with Docker Compose. Modules separate records,
search, planning and integrations within one codebase.

**Write path.** The UI sends commands to the backend. The backend validates
fields and paths, checks the record revision, writes the Markdown file
atomically, then updates the index. A failed index update is recovered by
reindexing and never discards a committed file. Every write, including
integration writes, goes through the same service. An outdated revision returns
a clear conflict rather than silently overwriting, even between two tabs. Avoid
first-release workflows that need atomic changes across many files.

**Editing and recovery.** External file changes come in through an explicit
import or reindex. Malformed files are reported, never deleted or rewritten.
Live filesystem sync and automatic merging can wait. File replacement uses a
same-filesystem temp file, flush, and atomic rename.

**Export and backup.** A portable content export, plus a full backup that also
captures non-rebuildable settings and operational data via a consistent snapshot
or paused writes. Secrets need an explicit protected backup strategy. Restore
must be demonstrated on an empty installation. Git history is optional and is
not a backup.

**Local access boundary.** Bind to loopback by default. LAN access is a separate
opt-in mode that requires an authentication and transport-security decision.
Sanitize rendered Markdown, constrain file paths, reject traversal, and protect
state-changing requests against cross-site abuse. Local hosting alone is not a
security control.

**Operational limits.** SQLite on local disk with one application writer (WAL is
same-host only). Measure memory, startup, indexing time and latency during the
prototype before publishing hardware requirements.

## Planning and dashboard extensions

| Item | Meaning | Editing rule |
|---|---|---|
| Deadline | When a task should be finished | Moving a work block does not change it. |
| Event | Something happening at a set time | Exists independently of task completion. |
| Work block | Time reserved to work on a task | References the ticket; does not copy it. |

Start with a weekly planner, date-only deadlines and simple events. Date-only
values stay dates. Timestamps keep timezone context, and future recurrence uses a
named timezone. Reminders and external sync come later.

**Plugin contract.** A plugin declares an ID, version, supported API version,
settings schema, widget contribution, required network endpoints and refresh
behaviour. The host provides validated settings, a namespaced cache, timeouts
and consistent error display. Plugins supply data for host-rendered cards, lists
and small charts. Only operator-trusted code is installed at first. In-process
plugins are not sandboxed, so a declared permission list is documentation, not
enforcement. Untrusted plugins need isolated execution, scoped APIs, network
enforcement and resource limits first. A plugin failure must leave task
management usable, and integrations never sit on the ticket-save path.

**Weather reference plugin.** Manually chosen location, Celsius, symbol,
precipitation, wind, hourly outlook and multi-day forecast from MET Norway
Locationforecast. Fetch via the backend, cache per location, respect expiry and
conditional requests, identify the app, and show the required attribution. Show
the last successful update and mark stale data. Forecast payloads go in a
disposable cache, never in Markdown.

## Interface concept

A restrained dark dashboard. A narrow sidebar holds Today, Inbox, Projects,
Planner, Documents and Settings. The main area puts current work first: a
compact Kanban board and a short weekly schedule. A secondary column holds
Today and the optional weather widget. Quick capture and search stay in the top
bar. Status always has a text label as well as colour. The layout is fixed,
keyboard navigation is supported, and there are no team controls.

## Delivery stages

| Stage | Deliverable | Exit condition |
|---|---|---|
| 1 Durable core | Projects, tickets, notes, Markdown storage, search | Records recover after restart; content index rebuilds. |
| 2 Daily use | Inbox, Today, archive, basic presets, documentation links | Capture, organize, complete and retrieve a real project. |
| 3 Planning | Deadlines, simple events, weekly work blocks | Time blocks reference tasks and keep deadline semantics. |
| 4 Extensions | Plugin contract, fixed dashboard, weather example | Weather failure leaves the core usable; caching verified. |
| 5 Future collaboration | Accounts, teams, permissions, deployment management | Separate design review before implementation. |

### Local-release acceptance criteria

1. Core workflows remain usable with the network disconnected.
2. A task captured with a title alone is found through search after restart.
3. Concurrent saves from two tabs cannot silently overwrite one another.
4. Malformed Markdown is reported without destroying the source file.
5. Export and restore preserve stable IDs, links, comments and attachments.
6. Disabling a plugin preserves core data and states its data-retention behaviour.

### Keep future teams possible

Keep stable IDs, schema versions, a workspace identifier and centralized record
operations now. Identities, memberships, assignment, authorization,
private/shared workspaces and permission-aware search come later.

### Open decisions

- Supported host operating systems and the Docker setup experience.
- How non-secret preferences and operational secrets are backed up.
- Whether completion history needs immutable revisions, or current records plus backups suffice.
- External-edit import, link preservation and archive behaviour with real project data.
- Performance targets, set only after benchmarking a representative workspace.

## How this maps onto Backlogger

The whitepaper uses generic product language. In Backlogger:

| Whitepaper | Backlogger today |
|---|---|
| Ticket / task | A **backlog item** document (`type: backlog_item`). |
| Ticket `status` (e.g. `in_progress`) | **Task state** (`task_state`). `status` is the separate **document status** (draft/active/archived). See [CONTEXT.md](../../CONTEXT.md). |
| `tickets/<id>/ticket.md` layout | Documents live at `data/projects/<project>/<folders>/<file>.md`, with the stable UUID in frontmatter. Not migrating. |
| Labels | Tags. |
| Documents / linked docs | Other document types plus `[[wiki links]]` and backlinks. |
| Inbox | A native Inbox project with same-ID filing (decided in #30). |
| Search index rebuild | `POST /api/admin/reindex`, `npm run reindex`. |
| Atomic write | `FsRepository`: temp file, fsync, rename. |
| Revision conflict | `If-Match` → 409 on stale revision (missing `If-Match` is still accepted). |

**Gaps between the whitepaper and the current code.** These are known and
deliberately not fixed yet. Each is tracked or scheduled in the
[roadmap](roadmap.md):

- **Network default.** The API binds `0.0.0.0` and CORS reflects any origin by
  default. The whitepaper requires loopback by default and opt-in LAN mode. No
  cross-site request protection exists.
- **Markdown sanitization.** Raw HTML is disabled in the renderer, but there is
  no explicit sanitizer.
- **Workspace export and restore.** Only per-document raw export exists. Backup
  is "stop and copy `data/`"; restore onto an empty install is not demonstrated
  (#5).
- **Comments, completion notes, checklists, priority, due dates, Today,
  presets, project archive, planner, plugins.** Not built.
- **Schema version / workspace ID.** Not present in frontmatter.
- **Sidecar-mode projects.** Not on the board; shared-sidecar lost updates
  remain possible.
