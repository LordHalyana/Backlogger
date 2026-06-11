import { useQuery } from '@tanstack/react-query';
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
import { Icon } from './components/Icon.js';
import { useProjects } from './lib/projects.js';
import { useTheme } from './lib/theme.js';
import { useWikiLinkNavigation } from './hooks/useWikiLinkNavigation.js';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts.js';
import { useReloadToast } from './hooks/useReloadToast.js';
import { useWorkspaceSelection } from './hooks/useWorkspaceSelection.js';
import { useShellOverlays } from './hooks/useShellOverlays.js';

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
  const overlays = useShellOverlays();
  const { theme, toggle: toggleTheme } = useTheme();
  const projects = useProjects();
  const selectedProject = projects.data?.find((p) => p.id === selectedProjectId);
  const projectReadOnly = selectedProject?.readOnly ?? false;
  const { data, isLoading, isError } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
  });

  useGlobalShortcuts({
    onToggleCommandPalette: overlays.togglePalette,
    onToggleHelp: overlays.toggleHelp,
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
            onClick={overlays.openPalette}
            title="Search documents (Ctrl/Cmd+K)"
            className="search-button"
          >
            <span>Search</span>
            <kbd>{navigator.platform.toLowerCase().includes('mac') ? 'Cmd' : 'Ctrl'}+K</kbd>
          </TopbarAction>
          {selectedProjectId && (
            <TopbarAction
              label="Import"
              onClick={overlays.openImport}
              disabled={projectReadOnly}
              title={
                projectReadOnly
                  ? 'Disable read-only mode before importing files'
                  : 'Import Markdown files into this project'
              }
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
              onClick={overlays.openGraph}
              active={overlays.graphOpen}
              aria-label="Knowledge graph"
              title="View knowledge graph"
              className="graph-button btn--icon"
            >
              <Icon name="graph" />
            </TopbarAction>
          )}
          <span className={cls}>
            <span className="dot" />
            {label}
          </span>
          <TopbarAction
            label="?"
            onClick={() => overlays.openHelp()}
            active={overlays.helpOpen}
            title="Help (?)"
            aria-label="Help"
            className="help-button btn--icon"
          >
            <Icon name="help" />
          </TopbarAction>
          <TopbarAction
            label="Settings"
            onClick={overlays.openSettings}
            active={overlays.settingsOpen}
            title="Settings"
            aria-label="Settings"
            className="settings-button btn--icon"
          >
            <Icon name="settings" />
          </TopbarAction>
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
                readOnly={projectReadOnly}
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
        open={overlays.paletteOpen}
        onClose={overlays.closePalette}
        onOpenDocument={openDocument}
      />
      {overlays.settingsOpen && (
        <SettingsDialog
          theme={theme}
          onToggleTheme={toggleTheme}
          onClose={overlays.closeSettings}
          onOpenHelp={() => {
            overlays.closeSettings();
            overlays.openHelp();
          }}
        />
      )}
      <HelpDrawer
        open={overlays.helpOpen}
        initialSlug={overlays.helpSlug}
        onClose={overlays.closeHelp}
      />
      {overlays.importOpen && selectedProjectId && !projectReadOnly && (
        <ImportDialog
          projectId={selectedProjectId}
          onClose={overlays.closeImport}
        />
      )}
      {overlays.graphOpen && selectedProjectId && (
        <KnowledgeGraph
          projectId={selectedProjectId}
          onOpenDocument={openDocument}
          onClose={overlays.closeGraph}
        />
      )}
    </div>
  );
}
