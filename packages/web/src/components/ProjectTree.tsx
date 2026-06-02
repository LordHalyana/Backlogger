import { useMemo, useState } from 'react';
import type { DocumentSummary } from '@backlogger/shared';
import { useDocuments } from '../lib/documents.js';
import { useFilteredDocuments } from '../lib/tags.js';
import { useFolders, useCreateFolder, useDeleteFolder } from '../lib/folders.js';
import { TagChip } from './TagChip.js';
import { NewDocumentDialog } from './NewDocumentDialog.js';

/** True if any ancestor folder (not self) is in the collapsed set. */
function isAncestorCollapsed(folder: string, collapsed: ReadonlySet<string>): boolean {
  const parts = folder.split('/');
  for (let i = 1; i < parts.length; i++) {
    if (collapsed.has(parts.slice(0, i).join('/'))) return true;
  }
  return false;
}

interface ProjectTreeProps {
  projectId: string;
  selectedDocumentId: string | null;
  onSelect: (id: string) => void;
  selectedTags?: readonly string[];
  onClearTags?: () => void;
  onRemoveTag?: (tag: string) => void;
}

function folderOf(projectId: string, path: string): string {
  const rest = path.startsWith(`${projectId}/`) ? path.slice(projectId.length + 1) : path;
  const idx = rest.lastIndexOf('/');
  return idx >= 0 ? rest.slice(0, idx) : '';
}

export function ProjectTree({
  projectId,
  selectedDocumentId,
  onSelect,
  selectedTags = [],
  onClearTags,
  onRemoveTag,
}: ProjectTreeProps): JSX.Element {
  const allDocs = useDocuments(projectId);
  const filteredDocs = useFilteredDocuments(projectId, selectedTags);
  const { data, isLoading, isError, error } =
    selectedTags.length > 0 ? filteredDocs : allDocs;
  const folders = useFolders(projectId);
  const createFolder = useCreateFolder();
  const deleteFolder = useDeleteFolder();
  const [showNew, setShowNew] = useState(false);
  const [manageFolders, setManageFolders] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  // Archived section is collapsed by default
  const [archiveSectionCollapsed, setArchiveSectionCollapsed] = useState(true);

  const toggleCollapsed = (folder: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  const grouped = useMemo(() => {
    const map = new Map<string, DocumentSummary[]>();
    for (const d of data ?? []) {
      const f = folderOf(projectId, d.path);
      const arr = map.get(f) ?? [];
      arr.push(d);
      map.set(f, arr);
    }
    return map;
  }, [data, projectId]);

  const { activeFolders, archivedFolders } = useMemo(() => {
    const s = new Set<string>(grouped.keys());
    for (const f of folders.data ?? []) s.add(f);
    s.delete('');
    const active: string[] = [];
    const archived: string[] = [];
    for (const f of [...s].sort()) {
      if (f === 'archived' || f.startsWith('archived/')) archived.push(f);
      else active.push(f);
    }
    return { activeFolders: active, archivedFolders: archived };
  }, [grouped, folders.data]);

  const rootDocs = grouped.get('') ?? [];

  const addFolder = (): void => {
    const name = window.prompt('New folder path (e.g. phases/p3/blocks):')?.trim();
    if (!name) return;
    createFolder.mutate(
      { projectId, folder: name },
      {
        onError: (e) => window.alert(`Failed to create folder: ${e.message}`),
      },
    );
  };

  const removeFolder = (folder: string): void => {
    const docs = grouped.get(folder) ?? [];
    if (docs.length > 0) {
      window.alert(`Folder "${folder}" is not empty.`);
      return;
    }
    if (!window.confirm(`Delete folder "${folder}"?`)) return;
    deleteFolder.mutate(
      { projectId, folder },
      {
        onError: (e) => window.alert(`Failed to delete folder: ${e.message}`),
      },
    );
  };

  const renderItem = (d: DocumentSummary): JSX.Element => (
    <li key={d.id}>
      <button
        type="button"
        className={'tree-item' + (d.id === selectedDocumentId ? ' selected' : '')}
        onClick={() => onSelect(d.id)}
        title={d.path}
        aria-label={d.title}
      >
        <span className="tree-item-title">{d.title}</span>
        {d.status === 'archived' && (
          <span className="badge badge-archived" aria-hidden="true">
            archived
          </span>
        )}
      </button>
    </li>
  );

  const renderFolder = (folder: string): JSX.Element | null => {
    if (isAncestorCollapsed(folder, collapsed)) return null;
    const items = grouped.get(folder) ?? [];
    const isCollapsed = collapsed.has(folder);
    const depth = folder.split('/').length - 1;
    // Show only the last path segment as the label
    const displayName = folder.split('/').pop() ?? folder;
    return (
      <li
        key={folder}
        className={'tree-group' + (isCollapsed ? ' collapsed' : '')}
        style={{ '--folder-depth': depth } as React.CSSProperties}
      >
        <div className="tree-group-label folder-row">
          <button
            type="button"
            className="folder-toggle"
            onClick={() => toggleCollapsed(folder)}
            aria-expanded={!isCollapsed}
            aria-label={(isCollapsed ? 'Expand' : 'Collapse') + ' folder ' + folder}
            title={folder}
          >
            <span className="folder-caret" aria-hidden="true">
              {isCollapsed ? '▸' : '▾'}
            </span>
            <span className="folder-name" title={folder}>
              {displayName}
            </span>
            {items.length > 0 && (
              <span className="folder-count" aria-hidden="true">
                {items.length}
              </span>
            )}
          </button>
          {manageFolders && (
            <button
              type="button"
              className="folder-delete-btn"
              onClick={() => removeFolder(folder)}
              aria-label={`Delete folder ${folder}`}
              title={
                items.length > 0
                  ? `Folder not empty (${items.length})`
                  : 'Delete folder'
              }
              disabled={items.length > 0}
            >
              ×
            </button>
          )}
        </div>
        {!isCollapsed && items.length > 0 && <ul>{items.map(renderItem)}</ul>}
      </li>
    );
  };

  return (
    <aside className="project-tree">
      <div className="project-tree-header">
        <h2>Documents</h2>
        <button type="button" onClick={() => setShowNew(true)} title="New document">
          + New
        </button>
      </div>
      <div className="folder-toolbar">
        <span className="folder-toolbar-label">Folders</span>
        <button
          type="button"
          className="folder-add-btn"
          onClick={addFolder}
          title="Add folder"
          aria-label="Add folder"
        >
          +
        </button>
        <button
          type="button"
          className={'folder-manage-btn' + (manageFolders ? ' active' : '')}
          onClick={() => setManageFolders((v) => !v)}
          aria-pressed={manageFolders}
          title="Toggle delete buttons"
        >
          {manageFolders ? 'Done' : 'Manage'}
        </button>
      </div>
      {selectedTags.length > 0 && (
        <div className="tag-filter-bar">
          <span className="tag-filter-label">Filter:</span>
          {selectedTags.map((t) => (
            <TagChip key={t} tag={t} active onRemove={onRemoveTag} />
          ))}
          <button type="button" className="tag-clear-btn" onClick={onClearTags}>
            Clear
          </button>
        </div>
      )}
      {isLoading && <p className="muted">Loading…</p>}
      {isError && <p className="error">Failed to load: {error?.message}</p>}
      {!isLoading && !isError && (data?.length ?? 0) === 0 && activeFolders.length === 0 && archivedFolders.length === 0 && (
        <p className="muted">No documents yet. Click &ldquo;+ New&rdquo; to create one.</p>
      )}
      <ul className="tree-groups">
        {activeFolders.map(renderFolder)}
        {rootDocs.length > 0 && (
          <li className={'tree-group' + (collapsed.has('') ? ' collapsed' : '')}>
            <div className="tree-group-label folder-row">
              <button
                type="button"
                className="folder-toggle"
                onClick={() => toggleCollapsed('')}
                aria-expanded={!collapsed.has('')}
                aria-label={(collapsed.has('') ? 'Expand' : 'Collapse') + ' root folder'}
                title={collapsed.has('') ? 'Expand' : 'Collapse'}
              >
                <span className="folder-caret" aria-hidden="true">
                  {collapsed.has('') ? '▸' : '▾'}
                </span>
                <span className="folder-name muted">(root)</span>
                <span className="folder-count" aria-hidden="true">
                  {rootDocs.length}
                </span>
              </button>
            </div>
            {!collapsed.has('') && <ul>{rootDocs.map(renderItem)}</ul>}
          </li>
        )}
      </ul>
      {archivedFolders.length > 0 && (
        <>
          <div className="tree-section-divider">
            <button
              type="button"
              className="tree-section-toggle"
              onClick={() => setArchiveSectionCollapsed((v) => !v)}
              aria-expanded={!archiveSectionCollapsed}
            >
              <span className="folder-caret" aria-hidden="true">
                {archiveSectionCollapsed ? '▸' : '▾'}
              </span>
              Archived
            </button>
          </div>
          {!archiveSectionCollapsed && (
            <ul className="tree-groups tree-groups--archived">
              {archivedFolders.map(renderFolder)}
            </ul>
          )}
        </>
      )}
      {showNew && (
        <NewDocumentDialog
          projectId={projectId}
          onClose={() => setShowNew(false)}
          onCreated={(d) => {
            setShowNew(false);
            onSelect(d.id);
          }}
        />
      )}
    </aside>
  );
}
