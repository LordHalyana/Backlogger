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

**Restoring**:
Unarchiving a document. A restored backlog item keeps its identity and task state and returns to that state's column.
_Avoid_: reopening

## Relationships

- Only a **backlog item** has a **task state**; other document types never appear on the board.
- A backlog item with no task state, or an unrecognised one, is treated as **To do** until it is moved; an unrecognised one is kept as written until then.
- **Blocked** is not a task state.
- The board shows active and draft backlog items; archived backlog items are not on the board.
- Reaching **Done** never archives a backlog item, and **archiving** never moves it to Done.

## Flagged ambiguities

- "status" was used for both document lifecycle and task progress. Resolved: **document status** is lifecycle, **task state** is progress.
- "Done" vs "archived": Done means the work is finished; archived means the document is no longer current. Neither implies the other.
