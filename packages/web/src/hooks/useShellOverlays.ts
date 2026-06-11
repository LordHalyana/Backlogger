import { useCallback, useState } from 'react';
import { readHelpSlugFromUrl } from '../lib/help-link.js';

export interface ShellOverlays {
  paletteOpen: boolean;
  settingsOpen: boolean;
  importOpen: boolean;
  graphOpen: boolean;
  helpOpen: boolean;
  helpSlug: string | null;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openImport: () => void;
  closeImport: () => void;
  openGraph: () => void;
  closeGraph: () => void;
  openHelp: (slug?: string | null) => void;
  closeHelp: () => void;
  toggleHelp: () => void;
}

export function useShellOverlays(): ShellOverlays {
  const initialHelpSlug = readHelpSlugFromUrl();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState<boolean>(() => initialHelpSlug !== null);
  const [helpSlug, setHelpSlug] = useState<string | null>(() => initialHelpSlug);

  const openPalette = useCallback((): void => setPaletteOpen(true), []);
  const closePalette = useCallback((): void => setPaletteOpen(false), []);
  const togglePalette = useCallback((): void => setPaletteOpen((open) => !open), []);

  const openSettings = useCallback((): void => setSettingsOpen(true), []);
  const closeSettings = useCallback((): void => setSettingsOpen(false), []);

  const openImport = useCallback((): void => setImportOpen(true), []);
  const closeImport = useCallback((): void => setImportOpen(false), []);

  const openGraph = useCallback((): void => setGraphOpen(true), []);
  const closeGraph = useCallback((): void => setGraphOpen(false), []);

  const openHelp = useCallback((slug: string | null = null): void => {
    setHelpSlug(slug);
    setHelpOpen(true);
  }, []);

  const closeHelp = useCallback((): void => setHelpOpen(false), []);

  const toggleHelp = useCallback((): void => {
    setHelpSlug(null);
    setHelpOpen((open) => !open);
  }, []);

  return {
    paletteOpen,
    settingsOpen,
    importOpen,
    graphOpen,
    helpOpen,
    helpSlug,
    openPalette,
    closePalette,
    togglePalette,
    openSettings,
    closeSettings,
    openImport,
    closeImport,
    openGraph,
    closeGraph,
    openHelp,
    closeHelp,
    toggleHelp,
  };
}
