// PROTOTYPE — throwaway floating variant switcher. Dev builds only.
import { useEffect } from 'react';
import { SIM_LABELS, SIM_MODES, type SimMode } from './useProtoBoard.js';

export interface VariantInfo {
  key: string;
  name: string;
}

interface Props {
  variants: readonly VariantInfo[];
  current: string;
  onChange: (key: string) => void;
  sim: SimMode;
  onSimChange: (sim: SimMode) => void;
  onExit: () => void;
}

export function PrototypeSwitcher({ variants, current, onChange, sim, onSimChange, onExit }: Props): JSX.Element | null {
  const idx = Math.max(0, variants.findIndex((v) => v.key === current));
  const cycle = (dir: -1 | 1): void =>
    onChange(variants[(idx + dir + variants.length) % variants.length]!.key);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable], .cm-editor, .proto-card, .proto-row'))) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft') cycle(-1);
      if (e.key === 'ArrowRight') cycle(1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  if (!import.meta.env.DEV) return null;
  const v = variants[idx]!;
  return (
    <div className="proto-switcher" role="toolbar" aria-label="Prototype variant switcher">
      <span className="proto-switcher-tag">PROTOTYPE</span>
      <button type="button" onClick={() => cycle(-1)} aria-label="Previous variant">←</button>
      <span className="proto-switcher-label">
        {v.key} — {v.name}
      </span>
      <button type="button" onClick={() => cycle(1)} aria-label="Next variant">→</button>
      <label className="proto-switcher-sim">
        Simulate
        <select value={sim} onChange={(e) => onSimChange(e.target.value as SimMode)}>
          {SIM_MODES.map((m) => (
            <option key={m} value={m}>
              {SIM_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={onExit} title="Leave the board prototype">✕</button>
    </div>
  );
}
