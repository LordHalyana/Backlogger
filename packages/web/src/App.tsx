import { useCallback, useState } from 'react';
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
import { TopbarAction } from './components/TopbarAction.js';
import { TagExplorer } from './components/TagExplorer.js';
import { readHelpSlugFromUrl } from './lib/help-link.js';
import { useTheme } from './lib/theme.js';
import { queryKeys } from './lib/query-keys.js';
import { useWikiLinkNavigation } from './hooks/useWikiLinkNavigation.js';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts.js';
import { useReloadToast } from './hooks/useReloadToast.js';
import { useWorkspaceSelection } from './hooks/useWorkspaceSelection.js';

async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch('/health');
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return (await res.json()) as HealthStatus;
}

export function App(): JSX.Element {
  const {
    projectId: selectedProjectId,
    documentId: selectedDocumentId,
    tags: selectedTags,
    selectProject,
    selectDocument,
    openDocument,
    toggleTag,
    clearTags,
    removeTag,
    clearDocumentIfRemoved,
  } = useWorkspaceSelection();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState<boolean>(() => readHelpSlugFromUrl() !== null);
  const [helpSlug, setHelpSlug] = useState<string | null>(() => readHelpSlugFromUrl());
  const { theme, toggle: toggleTheme } = useTheme();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
  });

  useGlobalShortcuts({
    onToggleCommandPalette: useCallback(() => setPaletteOpen((open) => !open), []),
    onToggleHelp: useCallback(() => {
      setHelpSlug(null);
      setHelpOpen((open) => !open);
    }, []),
  });

  useWikiLinkNavigation({
    projectId: selectedProjectId,
    onNavigate: openDocument,
  });

  const reload = useReloadToast({
    projectId: selectedProjectId,
    onRemovedIds: clearDocumentIfRemoved,
  });

  const cls = isError ? 'health err' : data ? 'health ok' : 'health';
  const label = isLoading
    ? 'checking...'
    : isError
      ? 'api unreachable'
      : `api ok - v${data!.version} - up ${Math.floor(data!.uptime)}s`;

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Backlogger</h1>
        <ProjectSwitcher selectedId={selectedProjectId} onSelect={selectProject} />
        <div className="topbar-right">
          <TopbarAction
            label="Search"
            onClick={() => setPaletteOpen(true)}
            title="Search documents (Ctrl/Cmd+K)"
            className="search-button"
          >
            <span>Search</span>
            <kbd>{navigator.platform.toLowerCase().includes('mac') ? 'Cmd' : 'Ctrl'}+K</kbd>
          </TopbarAction>
          {selectedProjectId && (
            <TopbarAction
              label="Import"
              onClick={() => setImportOpen(true)}
              title="Import Markdown files into this project"
              className="import-button"
            />
          )}
          {selectedProjectId && (
            <TopbarAction
              label={reload.isPending ? 'Reloading...' : 'Reload'}
              disabled={reload.isPending}
              onClick={reload.trigger}
              title="Re-sync this project from disk"
              className="reload-button"
            />
          )}
          {selectedProjectId && (
            <TopbarAction
              label="Graph"
              onClick={() => setGraphOpen(true)}
              active={graphOpen}
              title="View knowledge graph"
              className="graph-button"
            />
          )}
          <span className={cls}>
            <span className="dot" />
            {label}
          </span>
          <TopbarAction
            label="?"
            onClick={() => {
              setHelpSlug(null);
              setHelpOpen(true);
            }}
            active={helpOpen}
            title="Help (?)"
            aria-label="Help"
            className="help-button"
          />
          <TopbarAction
            label="Settings"
            onClick={() => setSettingsOpen(true)}
            active={settingsOpen}
            title="Settings"
            aria-label="Settings"
            className="settings-button"
          />
        </div>
      </header>
      <main className="content">
        {selectedProjectId ? (
          <div className="project-layout">
            <div className="project-sidebar">
              <ProjectTree
                projectId={selectedProjectId}
                selectedDocumentId={selectedDocumentId}
                onSelect={selectDocument}
                selectedTags={selectedTags}
                onClearTags={clearTags}
                onRemoveTag={removeTag}
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
                onDeleted={() => selectDocument(null)}
                onOpenDocument={openDocument}
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
        onOpenDocument={openDocument}
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
            void qc.invalidateQueries({ queryKey: queryKeys.documents(selectedProjectId) });
          }}
        />
      )}
      {graphOpen && selectedProjectId && (
        <KnowledgeGraph
          projectId={selectedProjectId}
          onOpenDocument={openDocument}
          onClose={() => setGraphOpen(false)}
        />
      )}
    </div>
  );
}
