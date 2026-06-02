import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { HealthStatus } from '@backlogger/shared';
import { ProjectSwitcher } from './components/ProjectSwitcher.js';
import { ProjectTree } from './components/ProjectTree.js';
import { DocumentWorkspace } from './components/DocumentWorkspace.js';
import { CommandPalette } from './components/CommandPalette.js';
import { ImportDialog } from './components/ImportDialog.js';
import { SettingsDialog } from './components/SettingsDialog.js';
import { HelpDrawer } from './components/HelpDrawer.js';
import { KnowledgeGraph } from './components/KnowledgeGraph.js';
import { readHelpSlugFromUrl } from './lib/help-link.js';
import { useTheme } from './lib/theme.js';
import { useTitles, type TitleRow } from './lib/links.js';
import { useReloadProject } from './lib/projects.js';
import { TagExplorer } from './components/TagExplorer.js';

async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch('/health');
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return (await res.json()) as HealthStatus;
}

export function App(): JSX.Element {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState<boolean>(() => readHelpSlugFromUrl() !== null);
  const [helpSlug, setHelpSlug] = useState<string | null>(() => readHelpSlugFromUrl());
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const reload = useReloadProject();
  const { theme, toggle: toggleTheme } = useTheme();
  const qc = useQueryClient();
  const titlesQuery = useTitles(selectedProjectId);
  const titlesRef = useRef<readonly TitleRow[]>([]);
  useEffect(() => {
    titlesRef.current = titlesQuery.data ?? [];
  }, [titlesQuery.data]);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
  });

  // Clear the selected document and tag filter whenever the project changes.
  useEffect(() => {
    setSelectedDocumentId(null);
    setSelectedTags([]);
  }, [selectedProjectId]);

  const toggleTag = (tag: string): void => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  // Global Ctrl/Cmd+K toggles the command palette.
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Global `?` (Shift+/) opens the help drawer when no input is focused.
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== '?') return;
      const t = event.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      setHelpSlug(null);
      setHelpOpen((open) => !open);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const openDocumentFromSearch = (projectId: string, documentId: string): void => {
    setSelectedProjectId(projectId);
    // setSelectedProjectId's effect clears the doc id; schedule selection after it lands.
    setTimeout(() => setSelectedDocumentId(documentId), 0);
  };

  // Delegated click handler for rendered `.wiki-link` anchors in the preview.
  // Resolves the title against the cached project titles list and navigates.
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLElement>('a.wiki-link');
      if (!anchor) return;
      event.preventDefault();
      const title = anchor.getAttribute('data-title');
      if (!title) return;
      const norm = title.trim().toLowerCase();
      const hit = titlesRef.current.find((t) => t.title.trim().toLowerCase() === norm);
      if (hit) {
        // Invalidate backlinks/titles for freshness when navigating.
        void qc.invalidateQueries({ queryKey: ['titles'] });
        openDocumentFromSearch(hit.project_id, hit.id);
      } else {
        anchor.classList.add('broken');
      }
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [qc]);

  const cls = isError ? 'health err' : data ? 'health ok' : 'health';
  const label = isLoading
    ? 'checking\u2026'
    : isError
      ? 'api unreachable'
      : `api ok \u00b7 v${data!.version} \u00b7 up ${Math.floor(data!.uptime)}s`;

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Backlogger</h1>
        <ProjectSwitcher selectedId={selectedProjectId} onSelect={setSelectedProjectId} />
        <div className="topbar-right">
          <button
            type="button"
            className="search-button"
            onClick={() => setPaletteOpen(true)}
            title="Search documents (Ctrl/Cmd+K)"
          >
            <span>Search</span>
            <kbd>{navigator.platform.toLowerCase().includes('mac') ? '\u2318' : 'Ctrl'}+K</kbd>
          </button>
          {selectedProjectId && (
            <button
              type="button"
              className="import-button"
              onClick={() => setImportOpen(true)}
              title="Import Markdown files into this project"
            >
              Import
            </button>
          )}
          {selectedProjectId && (
            <button
              type="button"
              className="reload-button"
              disabled={reload.isPending}
              onClick={() => {
                const pid = selectedProjectId;
                reload.mutate(pid, {
                  onSuccess: (r) => {
                    setToast({
                      kind: 'ok',
                      text: `Reloaded ${pid}: +${r.added}/~${r.updated}/-${r.removed} in ${r.durationMs} ms`,
                    });
                    if (selectedDocumentId && r.removedIds.includes(selectedDocumentId)) {
                      setSelectedDocumentId(null);
                    }
                    window.setTimeout(() => setToast(null), 4000);
                  },
                  onError: (err) => {
                    setToast({ kind: 'err', text: `Reload failed: ${err.message}` });
                    window.setTimeout(() => setToast(null), 4000);
                  },
                });
              }}
              title="Re-sync this project from disk"
            >
              {reload.isPending ? 'Reloading\u2026' : 'Reload'}
            </button>
          )}
          {selectedProjectId && (
            <button
              type="button"
              className="graph-button"
              onClick={() => setGraphOpen(true)}
              title="View knowledge graph"
            >
              Graph
            </button>
          )}
          <span className={cls}>
            <span className="dot" />
            {label}
          </span>
          <button
            type="button"
            className="help-button"
            onClick={() => {
              setHelpSlug(null);
              setHelpOpen(true);
            }}
            title="Help (?)"
            aria-label="Help"
          >
            ?
          </button>
          <button
            type="button"
            className="settings-button"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
          >
            ⚙
          </button>
        </div>
      </header>
      {toast && (
        <div className={`app-toast ${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}
      <main className="content">
        {selectedProjectId ? (
          <div className="project-layout">
            <div className="project-sidebar">
              <ProjectTree
                projectId={selectedProjectId}
                selectedDocumentId={selectedDocumentId}
                onSelect={setSelectedDocumentId}
                selectedTags={selectedTags}
                onClearTags={() => setSelectedTags([])}
                onRemoveTag={(t) => setSelectedTags((prev) => prev.filter((x) => x !== t))}
              />
              <TagExplorer
                projectId={selectedProjectId}
                selectedTags={selectedTags}
                onToggle={toggleTag}
              />
            </div>
            {selectedDocumentId ? (
              <DocumentWorkspace
                projectId={selectedProjectId}
                documentId={selectedDocumentId}
                theme={theme}
                onDeleted={() => setSelectedDocumentId(null)}
                onOpenDocument={openDocumentFromSearch}
              />
            ) : (
              <div className="workspace-empty">
                <p>Select a document, or create a new one.</p>
              </div>
            )}
          </div>
        ) : (
          <p>Select or create a project to begin.</p>
        )}
      </main>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenDocument={openDocumentFromSearch}
      />
      {settingsOpen && (
        <SettingsDialog
          theme={theme}
          onToggleTheme={toggleTheme}
          onClose={() => setSettingsOpen(false)}
          onOpenHelp={() => {
            setSettingsOpen(false);
            setHelpSlug(null);
            setHelpOpen(true);
          }}
        />
      )}
      <HelpDrawer
        open={helpOpen}
        initialSlug={helpSlug}
        onClose={() => setHelpOpen(false)}
      />
      {importOpen && selectedProjectId && (
        <ImportDialog
          projectId={selectedProjectId}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            void qc.invalidateQueries({ queryKey: ['documents', selectedProjectId] });
          }}
        />
      )}
      {graphOpen && selectedProjectId && (
        <KnowledgeGraph
          projectId={selectedProjectId}
          onOpenDocument={openDocumentFromSearch}
          onClose={() => setGraphOpen(false)}
        />
      )}
    </div>
  );
}
