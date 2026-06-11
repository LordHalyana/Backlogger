interface SkippedFile {
  path: string;
  reason: string;
}

interface CountItem {
  label: string;
  value: number | string;
}

interface ReindexResultSummaryProps {
  counts: CountItem[];
  skipped: readonly SkippedFile[];
  limit?: number;
}

export function ReindexResultSummary({
  counts,
  skipped,
  limit = 8,
}: ReindexResultSummaryProps): JSX.Element {
  const shown = skipped.slice(0, limit);
  const remaining = skipped.length - shown.length;

  return (
    <div className="reindex-summary">
      <dl className="reindex-summary-counts">
        {counts.map((item) => (
          <div key={item.label} className="reindex-summary-count">
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      {skipped.length > 0 ? (
        <div className="reindex-summary-skipped">
          <p>Skipped files</p>
          <ul>
            {shown.map((item) => (
              <li key={`${item.path}:${item.reason}`}>
                <code>{item.path}</code>
                <span>{item.reason}</span>
              </li>
            ))}
            {remaining > 0 && <li>...and {remaining} more</li>}
          </ul>
        </div>
      ) : (
        <p className="reindex-summary-empty">No skipped files.</p>
      )}
    </div>
  );
}
