import { useMemo, useState } from 'react';
import type { DocumentSummary, DocumentType } from '@backlogger/shared';
import { useDocuments } from '../lib/documents.js';
import { useFilteredDocuments } from '../lib/tags.js';
import { useFolders, useCreateFolder, useDeleteFolder } from '../lib/folders.js';
import { TagChip } from './TagChip.js';
import { NewDocumentDialog } from './NewDocumentDialog.js';

interface ProjectTreeProps {
  projectId: string;
  selectedDocumentId: string | null;
  onSelect: (id: string) => void;
  selectedTags?: readonly string[];
  onClearTags?: () => void;
  onRemoveTag?: (tag: string) => void;
}

const TYPE_BADGE: Record<DocumentType, string> = {
  idea: 'idea',
  design_doc: 'design',
  implementation_plan: 'plan',
  backlog_item: 'backlog',
  note: 'note',
  finding: 'finding',
};

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

  const allFolders = useMemo(() => {
    const s = new Set<string>(grouped.keys());
    for (const f of folders.data ?? []) s.add(f);
    s.delete('');
    return [...s].sort();
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
        <span
          className={`badge badge-type badge-type-${d.type}`}
          aria-hidden="true"
        >
          {TYPE_BADGE[d.type]}
        </span>
        {d.status !== 'draft' && (
          <span className={`badge badge-${d.status}`} aria-hidden="true">
            {d.status}
          </span>
        )}
      </button>
    </li>
  );

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
      {!isLoading && !isError && (data?.length ?? 0) === 0 && allFolders.length === 0 && (
        <p className="muted">No documents yet. Click &ldquo;+ New&rdquo; to create one.</p>
      )}
      <ul className="tree-groups">
        {allFolders.map((folder) => {
          const items = grouped.get(folder) ?? [];
          const isCollapsed = collapsed.has(folder);
          return (
            <li key={folder} className={'tree-group' + (isCollapsed ? ' collapsed' : '')}>
              <div className="tree-group-label folder-row">
                <button
                  type="button"
                  className="folder-toggle"
                  onClick={() => toggleCollapsed(folder)}
                  aria-expanded={!isCollapsed}
                  aria-label={(isCollapsed ? 'Expand' : 'Collapse') + ' folder ' + folder}
                  title={isCollapsed ? 'Expand' : 'Collapse'}
                >
                  <span className="folder-caret" aria-hidden="true">
                    {isCollapsed ? '▸' : '▾'}
                  </span>
                  <span className="folder-name" title={folder}>
                    {folder}
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
        })}
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
