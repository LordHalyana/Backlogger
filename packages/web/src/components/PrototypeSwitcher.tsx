// PROTOTYPE — throwaway floating variant switcher (← / → cycle; not in production builds).

import { useEffect, type ReactNode } from 'react';

export interface PrototypeVariant {
  key: string;
  name: string;
}

export function readVariant(keys: readonly string[]): string {
  const v = new URLSearchParams(window.location.search).get('variant')?.toUpperCase();
  return v && keys.includes(v) ? v : keys[0]!;
}

export function PrototypeSwitcher({
  variants,
  current,
  onChange,
  children,
}: {
  variants: readonly PrototypeVariant[];
  current: string;
  onChange: (key: string) => void;
  /** Extra prototype-only controls (scenario, failure simulation…). */
  children?: ReactNode;
}): JSX.Element | null {
  const i = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );
  const go = (d: number): void => {
    const next = variants[(i + d + variants.length) % variants.length]!.key;
    const u = new URL(window.location.href);
    u.searchParams.set('variant', next);
    window.history.replaceState(null, '', u);
    onChange(next);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement;
      if (
        t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable
      )
        return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  if (!import.meta.env.DEV) return null;
  const v = variants[i]!;
  return (
    <div className="proto-switcher" role="toolbar" aria-label="Prototype controls">
      <button type="button" onClick={() => go(-1)} aria-label="Previous variant">
        ←
      </button>
      <span className="proto-switcher-label">
        {v.key} — {v.name}
      </span>
      <button type="button" onClick={() => go(1)} aria-label="Next variant">
        →
      </button>
      {children}
    </div>
  );
}
