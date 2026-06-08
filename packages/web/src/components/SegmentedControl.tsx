import type { KeyboardEvent } from 'react';

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  /** Accessible label for the group. */
  ariaLabel: string;
  /** Extra class names for positioning (e.g. `view-mode-toggle`). */
  className?: string;
}

/**
 * A small reusable segmented (toggle-button group) control. Keeps keyboard and
 * ARIA behavior consistent across the app: arrow keys move the active segment,
 * and each option exposes `aria-pressed`.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: SegmentedControlProps<T>): JSX.Element {
  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const next = options[(index + delta + options.length) % options.length];
    if (next) onChange(next.value);
  };

  return (
    <div className={'segmented' + (className ? ' ' + className : '')} role="group" aria-label={ariaLabel}>
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          className={'segmented-option' + (value === opt.value ? ' active' : '')}
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          onKeyDown={(e) => handleKeyDown(e, i)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
