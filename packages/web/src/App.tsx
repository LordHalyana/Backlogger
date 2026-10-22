import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { HealthStatus } from '@backlogger/shared';
import { ProjectSwitcher } from './components/ProjectSwitcher.js';
import { ProjectTree } from './components/ProjectTree.js';
import { DocumentWorkspace } from './components/DocumentWorkspace.js';
import { TaskBoard } from './components/TaskBoard.js';
import { SegmentedControl } from './components/SegmentedControl.js';
import { CommandPalette } from './components/CommandPalette.js';
import { ImportDialog } from './components/ImportDialog.js';
import { SettingsDialog } from './components/SettingsDialog.js';
import { HelpDrawer } from './components/HelpDrawer.js';
import { KnowledgeGraph } from './components/KnowledgeGraph.js';
import { TopbarAction } from './components/TopbarAction.js';
import { TagExplorer } from './components/TagExplorer.js';
import { Icon } from './components/Icon.js';
import { WorkspaceRail } from './components/WorkspaceRail.js';
import { CapturePalette } from './components/CapturePalette.js';
import { InboxTriage } from './components/InboxTriage.js';
import { CurrentWorkDrawer } from './components/CurrentWorkDrawer.js';
import { RecoveryBanner } from './components/RecoveryBanner.js';
import { RecoveryPage } from './components/RecoveryPage.js';
import { useInboxCount } from './lib/inbox.js';
import { readDrawerOpen, writeDrawerOpen } from './lib/current-work.js';
import { useProjects } from './lib/projects.js';
import { formatUptime } from './lib/display.js';
import { useWikiLinkNavigation } from './hooks/useWikiLinkNavigation.js';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts.js';
import { useReloadToast } from './hooks/useReloadToast.js';
import { useWorkspaceSelection } from './hooks/useWorkspaceSelection.js';
import { useShellOverlays } from './hooks/useShellOverlays.js';

const PROJECT_VIEW_OPTIONS = [
  { value: 'documents', label: 'Documents' },
  { value: 'board', label: 'Board' },
] as const;

async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch('/health');
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return (await res.json()) as HealthStatus;
}

export function App(): JSX.Element {
  const {
    projectId: selectedProjectId,
    documentId: selectedDocumentId,
    view,
    tags: selectedTags,
    triage,
    landing,
    recovery,
    openTriage,
    openRecovery,
    selectRecoveryOperation,
    selectProject,
    selectView,
    selectTreeDocument,
    selectDocument,
    openDocument,
    relocateProject,
    toggleTag,
    clearTags,
    removeTag,
    clearDocumentIfRemoved,
  } = useWorkspaceSelection();
  const overlays = useShellOverlays();
  const projects = useProjects();
  const selectedProject = projects.data?.find((p) => p.id === selectedProjectId);
  const projectReadOnly = selectedProject?.readOnly ?? false;
  const projectList = projects.data ?? [];
  const inbox = projectList.find((p) => p.isInbox);
  const inboxCount = useInboxCount(inbox?.id);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(() => readDrawerOpen());
  // The task opened from triage, whose editor links back to triage.
  const [fromTriage, setFromTriage] = useState<string | null>(null);

  const openCapture = useCallback((): void => setCaptureOpen(true), []);
  const toggleDrawer = useCallback((): void => {
    setDrawerOpen((open) => {
      writeDrawerOpen(!open);
      return !open;
    });
  }, []);
  const goToBoard = useCallback(
    (projectId: string): void => {
      selectProject(projectId);
      selectView('board');
    },
    [selectProject, selectView],
  );
  const openFromTriage = useCallback(
    (projectId: string, documentId: string): void => {
      setFromTriage(documentId);
      openDocument(projectId, documentId);
    },
    [openDocument],
  );
  const backToTriage =
    fromTriage !== null && fromTriage === selectedDocumentId
      ? () => {
          setFromTriage(null);
          openTriage();
        }
      : undefined;
  const { data, isLoading, isError } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
  });

  useGlobalShortcuts({
    onToggleCommandPalette: overlays.togglePalette,
    onToggleHelp: overlays.toggleHelp,
    onCapture: openCapture,
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
      : `v${data!.version}`;
  const healthTitle = isError
    ? 'API unreachable'
    : !data
      ? 'Checking API health...'
      : [
          `API: ${data.status}`,
          `version ${data.version}`,
          `uptime ${formatUptime(data.uptime)}`,
          `database ${data.database} · storage ${data.storage} · templates ${data.templates} · fts ${data.fts}`,
        ].join('\n');

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <Icon name="book" className="topbar-logo" />
          <h1>Backlogger</h1>
        </div>
        <span className="topbar-divider" aria-hidden="true" />
        <ProjectSwitcher
          selectedId={selectedProjectId}
          onSelect={selectProject}
          onCapture={openCapture}
          onOpenTriage={openTriage}
          onToggleCurrentWork={toggleDrawer}
          onOpenRecovery={openRecovery}
        />
        <span className="topbar-spacer" />
        <span className="topbar-divider" aria-hidden="true" />
        <div className="topbar-right">
          <TopbarAction
            label="Current work"
            onClick={toggleDrawer}
            active={drawerOpen}
            title="Show or hide Current work"
            className="current-work-button"
          >
            Current work
          </TopbarAction>
          <TopbarAction
            label="Search"
            onClick={overlays.openPalette}
            title="Search documents (Ctrl/Cmd+K)"
            className="search-button"
          >
            <Icon name="search" />
            <span>Search</span>
            <kbd>{navigator.platform.toLowerCase().includes('mac') ? 'Cmd' : 'Ctrl'}+K</kbd>
          </TopbarAction>
          {selectedProjectId && (
            <TopbarAction
              label="Import"
              aria-label="Import"
              onClick={overlays.openImport}
              disabled={projectReadOnly}
              title={
                projectReadOnly
                  ? 'Disable read-only mode before importing files'
                  : 'Import Markdown files into this project'
              }
              className="import-button btn--icon"
            >
              <Icon name="upload" />
            </TopbarAction>
          )}
          {selectedProjectId && (
            <TopbarAction
              label="Reload"
              aria-label={reload.isPending ? 'Reloading…' : 'Reload'}
              disabled={reload.isPending}
              onClick={reload.trigger}
              title="Re-sync this project from disk"
              className="reload-button btn--icon"
            >
              <Icon name="refresh" />
            </TopbarAction>
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
          <span className={cls} title={healthTitle}>
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
      <RecoveryBanner onOpen={() => openRecovery()} />
      <main className="content daily-shell">
        <WorkspaceRail
          projects={projectList}
          inboxCount={inboxCount}
          triageOpen={triage}
          selectedProjectId={selectedProjectId}
          onCapture={openCapture}
          onOpenTriage={openTriage}
          onSelectProject={goToBoard}
        />
        <div className="daily-main">
          {recovery ? (
            <RecoveryPage
              operationId={recovery.operationId}
              projects={projectList}
              onSelect={selectRecoveryOperation}
              onOpenTask={openDocument}
            />
          ) : triage ? (
            <InboxTriage
              projects={projectList}
              onOpenTask={openFromTriage}
              onOpenRecovery={openRecovery}
            />
          ) : selectedProjectId ? (
            <div className="project-layout">
              <div className="project-sidebar">
                <div className="sidebar-view-switch">
                  <SegmentedControl
                    ariaLabel="Project view"
                    value={view}
                    options={PROJECT_VIEW_OPTIONS}
                    onChange={selectView}
                  />
                </div>
                <ProjectTree
                  projectId={selectedProjectId}
                  selectedDocumentId={selectedDocumentId}
                  onSelect={selectTreeDocument}
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
              {view === 'board' && !selectedDocumentId ? (
                <TaskBoard
                  projectId={selectedProjectId}
                  onOpenCard={selectDocument}
                  onOpenRecovery={openRecovery}
                />
              ) : selectedDocumentId ? (
                <DocumentWorkspace
                  projectId={selectedProjectId}
                  documentId={selectedDocumentId}
                  theme="dark"
                  onDeleted={() => selectDocument(null)}
                  onOpenDocument={openDocument}
                  onBackToBoard={
                    backToTriage ?? (view === 'board' ? () => selectDocument(null) : undefined)
                  }
                  backLabel={backToTriage ? 'Back to Inbox triage' : undefined}
                  landing={landing}
                  onProjectMoved={relocateProject}
                  onOpenSearch={overlays.openPalette}
                  onOpenRecovery={openRecovery}
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
        </div>
        {drawerOpen && (
          <CurrentWorkDrawer
            onOpenTask={openDocument}
            onGoToBoard={goToBoard}
            onOpenRecovery={openRecovery}
            onClose={toggleDrawer}
          />
        )}
      </main>
      {captureOpen && (
        <CapturePalette
          projects={projectList}
          onClose={() => setCaptureOpen(false)}
          onOpenTask={(doc) => {
            setCaptureOpen(false);
            openDocument(doc.project_id, doc.id);
          }}
        />
      )}
      <CommandPalette
        open={overlays.paletteOpen}
        onClose={overlays.closePalette}
        onOpenDocument={openDocument}
      />
      {overlays.settingsOpen && (
        <SettingsDialog
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
