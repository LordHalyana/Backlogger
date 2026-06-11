type IconName = 'help' | 'settings' | 'graph' | 'sun' | 'moon' | 'close';

interface IconProps {
  name: IconName;
  className?: string;
}

const ICON_PATHS: Record<IconName, JSX.Element> = {
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.75 9a2.4 2.4 0 0 1 4.5 1.16c0 1.75-2.25 1.95-2.25 3.59" />
      <path d="M12 17.25h.01" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.75v2" />
      <path d="M12 19.25v2" />
      <path d="m4.8 4.8 1.42 1.42" />
      <path d="m17.78 17.78 1.42 1.42" />
      <path d="M2.75 12h2" />
      <path d="M19.25 12h2" />
      <path d="m4.8 19.2 1.42-1.42" />
      <path d="m17.78 6.22 1.42-1.42" />
    </>
  ),
  graph: (
    <>
      <circle cx="6" cy="7" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="11" cy="18" r="2.5" />
      <path d="m8.35 8.35 6.95 6.95" />
      <path d="m15.65 7.45-3.5 8.2" />
      <path d="m8.4 15.95-1.45-6.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.75v2" />
      <path d="M12 19.25v2" />
      <path d="M2.75 12h2" />
      <path d="M19.25 12h2" />
      <path d="m4.8 4.8 1.42 1.42" />
      <path d="m17.78 17.78 1.42 1.42" />
      <path d="m4.8 19.2 1.42-1.42" />
      <path d="m17.78 6.22 1.42-1.42" />
    </>
  ),
  moon: (
    <path d="M20 14.7A8 8 0 0 1 9.3 4 6.75 6.75 0 1 0 20 14.7Z" />
  ),
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
};

export function Icon({ name, className }: IconProps): JSX.Element {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}
