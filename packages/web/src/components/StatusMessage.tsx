type StatusKind = 'loading' | 'empty' | 'error';

interface StatusMessageProps {
  kind: StatusKind;
  children: React.ReactNode;
  /** Extra classes for layout overrides (e.g. graph overlay positioning). */
  className?: string;
}

/**
 * Unified component for loading, empty, and error states inside panels.
 * Uses `role="alert"` + `aria-live="assertive"` for errors; `role="status"` +
 * `aria-live="polite"` for loading/empty states.
 */
export function StatusMessage({ kind, children, className }: StatusMessageProps): JSX.Element {
  return (
    <div
      className={`status-message status-message--${kind}${className ? ` ${className}` : ''}`}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
    >
      {children}
    </div>
  );
}
