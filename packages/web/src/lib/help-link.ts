// URL <-> Help drawer synchronisation.
//
// The drawer reflects a `?help=<slug>` query param so users can bookmark
// or share deep links. Pushing the state uses `history.replaceState` to
// avoid polluting the back-button history with chapter switches.

const PARAM = 'help';

export function readHelpSlugFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const u = new URL(window.location.href);
  return u.searchParams.get(PARAM);
}

export function writeHelpSlugToUrl(slug: string | null): void {
  if (typeof window === 'undefined') return;
  const u = new URL(window.location.href);
  if (slug) {
    u.searchParams.set(PARAM, slug);
  } else {
    u.searchParams.delete(PARAM);
  }
  window.history.replaceState(window.history.state, '', u.toString());
}
