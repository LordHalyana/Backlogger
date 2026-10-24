# Backlogger

## Language

**Document status**:
The lifecycle of a document: draft, active or archived. Says whether the document is current, not whether its work is done.
_Avoid_: state, progress

**Task state**:
How far the work in a backlog item has progressed: To do, In progress or Done. Kept separate from document status. Any task state may move to any other.
_Avoid_: status, column, progress

**Board column**:
The display of one task state on the board. Columns are fixed and mirror task states one-to-one.
_Avoid_: lane, stage

**Reopening**:
Moving a backlog item out of Done. An ordinary task state change, not a separate action.

**Archiving**:
Marking a document as no longer current. An explicit action, separate from reaching Done; it never changes task state. An archived backlog item that was not Done has been abandoned.
_Avoid_: completing, cancelling

**Inbox**:
A native project that receives captures made before a destination is chosen. Filing moves a backlog item from the Inbox into another project and keeps its identity. Inbox is a place, not a task state.
_Avoid_: backlog state, unfiled status

**Capture**:
Creating a backlog item from a title alone, either into the Inbox or into the project currently open. Everything else about the item can be added later.
_Avoid_: quick add, new ticket

**Current work**:
A view, across native projects, of the backlog items that are In progress. It is derived from task state alone: nothing is chosen for it or stored for it, and it carries no notion of a day.
_Avoid_: Today, planned, focus

**Restoring**:
Unarchiving a document. A restored backlog item keeps its identity and task state and returns to that state's column.
_Avoid_: reopening

**Workspace backup**:
An archive that can recreate this whole workspace, its records and its recovery state, on an empty install. Projects mounted from elsewhere are recorded, not copied.
_Avoid_: export, snapshot

**Workspace restore**:
Recreating a workspace from a workspace backup on an empty install. It never merges into or replaces a workspace already in use.
_Avoid_: restoring, import

**Search match**:
The record that earned a search result its place: the document itself (title, tags or body), labelled **Description match**, or one of its comments, labelled **Comment match**. A task appears once, labelled with its strongest match.
_Avoid_: hit type, result source

## Relationships

- Only a **backlog item** has a **task state**; other document types never appear on the board.
- A backlog item with no task state, or an unrecognised one, is treated as **To do** until it is moved; an unrecognised one is kept as written until then.
- **Blocked** is not a task state.
- The board shows active and draft backlog items; archived backlog items are not on the board.
- **Current work** follows the board's rules about which items are shown: drafts are included and archived items are not. An item leaves it when it leaves In progress, and a restored In progress item returns to it.
- There is exactly one designated **Inbox**. A project that happens to be named "Inbox" is not the Inbox.
- Every term of a search must occur within one **search match**: the description, or a single comment. Terms spread across separate comments do not match.
- Reaching **Done** never archives a backlog item, and **archiving** never moves it to Done.

## Flagged ambiguities

- "status" was used for both document lifecycle and task progress. Resolved: **document status** is lifecycle, **task state** is progress.
- "Done" vs "archived": Done means the work is finished; archived means the document is no longer current. Neither implies the other.
- "restore" was used for both unarchiving a document and recreating a workspace from a backup. Resolved: **restoring** is unarchiving, as the app's "Restore task" says; the other is always a **workspace restore**.
- The product-direction whitepaper says "ticket" and "task" and gives a ticket a `status: in_progress`. In Backlogger these are a **backlog item** and its **task state**; `status` stays **document status**.
