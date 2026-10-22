---
id: f6b8e7d9-49a8-40a0-9b5a-c0b858f278e7
title: Documentation Index
project: backlogger-docs
type: note
status: active
created_at: '2026-06-09T00:00:00.000Z'
updated_at: '2026-10-18T00:00:00.000Z'
tags: ["docs"]
---

# Documentation Index

Date: 2026-10-18

This is the current docs index for Backlogger. It separates active guidance
from temporary cleanup artifacts and archived phase plans.

## Start Here

- [Product direction](design/product-direction.md) — the Local Productivity Workspace whitepaper v0.1 we are refactoring toward
- [Current roadmap](design/roadmap.md) — where each delivery stage stands
- [Architecture](design/architecture.md)
- [Data storage and project mounts](operations/data-storage.md)
- [API reference](api.md)
- [Release notes](release-notes.md)
- [Testing](testing.md)

## Design Docs

- [First board spec](design/first-board.md) (mirror of issue #13)
- [Sidecar metadata](design/sidecar-metadata.md)
- [Archive invariants](design/archive-invariants.md)
- [Derived data contract](design/derived-data.md)
- [Folder invariants](design/folder-invariants.md)
- [UI conventions](design/ui-conventions.md)
- [Historical design overview](design/overview.md)

`design/overview.md` is retained for history only. Use
`design/product-direction.md` for where the product is going,
`design/architecture.md` for how it works now, and `design/roadmap.md` for
what is next. Decisions and specs live in GitHub Issues; see
[agents/issue-tracker.md](agents/issue-tracker.md).

## Operations

- [Backup and restore](operations/backup-restore.md)
- [Deployment](operations/deployment.md)
- [Monitoring](operations/monitoring.md)
- [Scripts](operations/scripts.md)
- [Security](operations/security.md)

## Cleanup Review Artifacts

The numbered analysis files at the top of `docs/` are temporary assignment
cleanup artifacts. Keep them updated while cleanup is active, then archive or
remove them after the review pass.

See [Analysis lifecycle](analysis-lifecycle.md).

## Archived Docs

Historical phase plans and stale roadmap material live under `archived/`.
Do not use files in that folder as current implementation requirements.
