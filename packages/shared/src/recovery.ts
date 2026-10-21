/**
 * Recovery review (spec #58, "Recovery API and guards"): operations a crash
 * or failure left pending, where they stand on disk now, and what the user
 * may do about them. Summaries never carry content; only the detail of one
 * operation shows the pending content.
 */

/** What the server lets the user do with a pending operation. Inspecting is always allowed. */
export type RecoveryAction = 'recheck' | 'abandon';

/**
 * - `resumable`: the files are in the known state before or after the
 *   operation; Recheck finishes it.
 * - `content_conflict`: a file holds content the operation did not expect.
 * - `structural`: a missing file, parent or owner, an ambiguous path, or an
 *   operation this version cannot recover; repair by hand, then Recheck.
 */
export type RecoveryKind = 'resumable' | 'content_conflict' | 'structural';

export type RecoveryReason =
  | 'interrupted'
  | 'content_changed'
  | 'file_missing'
  | 'parent_missing'
  | 'owner_changed'
  | 'ambiguous_path'
  | 'unsupported';

/** One entry of `GET /api/recovery`. */
export interface RecoverySummary {
  operation_id: string;
  command: string;
  state: 'pending';
  created_at: string;
  kind: RecoveryKind;
  reason: RecoveryReason;
  message: string;
  project_id: string | null;
  task_id: string | null;
  comment_id: string | null;
  /** The operation is running in this process right now, not stopped. */
  in_progress: boolean;
}

/** A file the operation covers. Revisions are `null` for an absent file. */
export interface RecoveryPath {
  /** Relative to `<dataDir>/projects/`. */
  path: string;
  /** The known state before the operation. */
  before_revision: string | null;
  /** The known state the operation leaves. */
  after_revision: string | null;
  /** The file as it is now. */
  observed_revision: string | null;
}

/** `GET /api/recovery/:operationId`. */
export interface RecoveryDetail extends RecoverySummary {
  paths: RecoveryPath[];
  actions: RecoveryAction[];
  /** Changes whenever what was reviewed changes; Abandon must present the current one. */
  review_token: string;
  /** The exact Markdown the operation meant to write, where it has some. */
  pending_content: string | null;
  /** The file as it is now; `null` when absent or not applicable. */
  current_content: string | null;
}

/** `GET /api/recovery`. */
export interface RecoveryList {
  operations: RecoverySummary[];
}

/** `POST /api/recovery/:operationId/recheck`: the original operation's fate after resuming it. */
export interface RecheckResult {
  operation_id: string;
  state: 'pending' | 'completed' | 'abandoned';
  /** The original acknowledgement once the operation completed. */
  acknowledgement: unknown;
  /** Present while the operation is still pending. */
  recovery: RecoveryDetail | null;
}

/** `POST /api/recovery/:operationId/abandon`, with its own `Idempotency-Key`. */
export interface AbandonRecoveryRequest {
  review_token: string;
}

export interface AbandonRecoveryAck {
  operation_id: string;
  command: 'recovery.abandon';
  target_operation_id: string;
  outcome: 'abandoned';
}
