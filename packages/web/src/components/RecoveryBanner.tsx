import { needsReview, useRecoveryList } from '../lib/recovery.js';

/**
 * The workspace banner under the top bar while any operation needs review.
 * Moves and deletions still running do not raise it, and it cannot be
 * dismissed: it goes once nothing needs review.
 */
export function RecoveryBanner({ onOpen }: { onOpen: () => void }): JSX.Element | null {
  const { data } = useRecoveryList();
  const count = data?.operations.filter(needsReview).length ?? 0;
  if (count === 0) return null;
  return (
    <section className="recovery-banner" aria-label="Recovery">
      <p>
        <strong>
          {count === 1 ? '1 item needs recovery review.' : `${count} items need recovery review.`}
        </strong>{' '}
        Some writes to them are paused until you review.
      </p>
      <button type="button" className="btn btn--sm" onClick={onOpen}>
        Open Recovery
      </button>
    </section>
  );
}
