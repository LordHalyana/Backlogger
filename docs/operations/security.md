---
id: dc506ee8-2f1b-4399-af83-f2b2d03c66b4
title: Security
project: backlogger-docs
type: note
status: active
created_at: '2026-06-04T00:00:00.000Z'
updated_at: '2026-06-04T00:00:00.000Z'
tags: []
---

# Security And Trust Boundaries

Date: 2026-06-04

## Intended Deployment

Backlogger is intended for a trusted, single-user, self-hosted environment.

It has no authentication, no authorization, and no multi-user isolation.

## Network Exposure

The API binds to `0.0.0.0` by default so the app is reachable on a local network.

This is convenient for LAN use but should be changed or protected on untrusted networks.

**Target (product direction).** The [Local Productivity Workspace](../design/product-direction.md)
direction requires binding to loopback by default, with LAN access as a separate
opt-in mode that needs an authentication and transport-security decision. It
also requires cross-site protection for state-changing requests and explicit
sanitization of rendered Markdown. None of these are implemented yet; see the
[roadmap](../design/roadmap.md).

Recommended options:

- Bind to `127.0.0.1`.
- Put the app behind a trusted reverse proxy with authentication.
- Restrict access at the firewall or container network layer.

## CORS Is Not Authentication

`BACKLOGGER_ALLOWED_ORIGINS` controls whether browser JavaScript from another origin can read responses.

It does not prevent direct HTTP requests from other clients.

Default:

```text
BACKLOGGER_ALLOWED_ORIGINS=*
```

Set a narrow allow-list outside trusted LAN use.

## Markdown Trust Boundary

Backlogger renders Markdown into HTML in the web app.

The shared Markdown renderer disables raw HTML. This is important because the preview uses `dangerouslySetInnerHTML`.

Current trust model:

- Markdown files under project folders are treated as trusted local content.
- Imported Markdown is accepted from the current user.
- Mounted external folders should only come from trusted sources.

If Backlogger becomes multi-user or internet-facing, add explicit HTML sanitization and authentication first.

## Filesystem Safety

The API validates filesystem access through `PathResolver` and `FsRepository`.

Current protections include:

- project id validation
- filename validation
- folder path validation
- relative path normalization
- path containment under `data/projects`
- rejection of traversal segments
- symlink checks below project root

Project root symlinks are allowed to support Docker volume mounts and local development layouts.

## Data Sensitivity

The data directory may contain private notes, project plans, credentials pasted into Markdown, or operational runbooks.

Treat backups and mounted folders as sensitive.

## Security Non-Goals

Current scope does not include:

- authentication
- RBAC
- audit logging
- encryption at rest
- tenant isolation
- untrusted document sandboxing

Those require explicit design work before deployment outside a trusted environment.
