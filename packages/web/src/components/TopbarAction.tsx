interface TopbarActionProps {
  /** Button label text (used when no children provided). */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Visually highlights the button when an associated panel is open. */
  active?: boolean;
  /** Feature-specific class for one-off layout overrides. */
  className?: string;
  title?: string;
  'aria-label'?: string;
  /** Override label with rich content (e.g. kbd shortcut hint). */
  children?: React.ReactNode;
}

/**
 * Topbar action button. Applies the shared `.btn .topbar-action` classes plus
 * an `.topbar-action--active` modifier when the associated panel is open.
 */
export function TopbarAction({
  label,
  onClick,
  disabled,
  active,
  className,
  title,
  children,
  'aria-label': ariaLabel,
}: TopbarActionProps): JSX.Element {
  return (
    <button
      type="button"
      className={`btn topbar-action${active ? ' topbar-action--active' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
    >
      {children ?? label}
    </button>
  );
}
