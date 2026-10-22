---
id: 9ff86fa4-5649-44b7-8691-2ed43a4180d6
title: Release Notes
project: backlogger-docs
type: note
status: active
created_at: '2026-10-22T00:00:00.000Z'
updated_at: '2026-10-22T00:00:00.000Z'
tags: ['docs']
---

# Release Notes

## Unreleased

### Breaking changes

- **Filing requires an `Idempotency-Key`.** `POST /api/documents/:id/file`
  now needs an `Idempotency-Key` header holding a client-generated UUID.
  Without one it returns `400 INVALID_COMMAND` and changes nothing. The body
  stays `{ target_project_id, revision }`.
- **Filing returns an acknowledgement, not the document.** A successful filing
  answers `200` with `{ operation_id, command, document_id,
source_project_id, target_project_id, outcome, result_revision }`. Fetch the
  document afterwards for its current state. Retrying with the same key
  returns the original acknowledgement.
- **Refresh open browser tabs after upgrading.** Tabs loaded before the
  upgrade file items without a key, and the server refuses those requests.

Permanent task and project deletion move to the same contract in a later
release. See [Filing and deletion API migration](https://github.com/LordHalyana/Backlogger/issues/58).

### Changes

- Filing a backlog item carries all of its comments into the target project,
  byte for byte, with no duplicates at either end. Filing is recoverable: a
  crash at any point is finished forward on restart or by Recheck on the
  Recovery API. A comment directory holding anything but the task's comments
  blocks the filing, with nothing moved. See
  [`POST /api/documents/:id/file`](api.md#post-apidocumentsidfile).
- Reload and Reindex follow a pending filing's manifest, so a task mid-filing
  is never shown twice.
