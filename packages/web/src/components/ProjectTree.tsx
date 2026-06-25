import { useMemo, useState } from 'react';
import type { DocumentSummary } from '@backlogger/shared';
import { FolderPathSchema } from '@backlogger/shared';
import { useDocuments } from '../lib/documents.js';
import { useFilteredDocuments } from '../lib/tags.js';
import { useFolders, useCreateFolder, useDeleteFolder } from '../lib/folders.js';
import { toastError, useDialog } from '../lib/dialog.js';
import { buildProjectTreeGroups, isAncestorCollapsed } from '../lib/project-tree-groups.js';
import { TagChip } from './TagChip.js';
import { NewDocumentDialog } from './NewDocumentDialog.js';
import { StatusMessage } from './StatusMessage.js';
import { FolderTreeGroup } from './FolderTreeGroup.js';

interface ProjectTreeProps {
  projectId: string;
  selectedDocumentId: string | null;
  onSelect: (id: string) => void;
  selectedTags?: readonly string[];
  onClearTags?: () => void;
  onRemoveTag?: (tag: string) => void;
  readOnly?: boolean;
}

export function ProjectTree({
  projectId,
  selectedDocumentId,
  onSelect,
  selectedTags = [],
  onClearTags,
  onRemoveTag,
  readOnly = false,
}: ProjectTreeProps): JSX.Element {
  const allDocs = useDocuments(projectId);
  const filteredDocs = useFilteredDocuments(projectId, selectedTags);
  const { data, isLoading, isError, error } =
    selectedTags.length > 0 ? filteredDocs : allDocs;
  const folders = useFolders(projectId);
  const createFolder = useCreateFolder();
  const deleteFolder = useDeleteFolder();
  const dialog = useDialog();
  const [showNew, setShowNew] = useState(false);
  const [manageFolders, setManageFolders] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [archiveSectionCollapsed, setArchiveSectionCollapsed] = useState(true);

  const toggleCollapsed = (folder: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  const { grouped, rootDocs, activeFolders, archivedFolders } = useMemo(
    () => buildProjectTreeGroups(projectId, data, folders.data),
    [data, folders.data, projectId],
  );

  const addFolder = async (): Promise<void> => {
    if (readOnly) return;
    const name = await dialog.prompt({
      title: 'New Folder',
      message: 'Enter a folder path:',
      placeholder: 'e.g. phases/p3/blocks',
      validate: (v) => {
        const result = FolderPathSchema.safeParse(v.trim());
        return result.success ? null : 'Invalid path - use lowercase letters, numbers, hyphens, and forward slashes only.';
      },
    });
    if (!name) return;
    createFolder.mutate(
      { projectId, folder: name.trim() },
      {
        onError: (e) => toastError(dialog, 'Failed to create folder', e),
      },
    );
  };

  const removeFolder = async (folder: string): Promise<void> => {
    if (readOnly) return;
    const docs = grouped.get(folder) ?? [];
    if (docs.length > 0) {
      await dialog.confirm({
        title: 'Folder not empty',
        message: `Folder "${folder}" still contains documents and cannot be deleted.`,
        confirmLabel: 'OK',
        cancelLabel: '',
      });
      return;
    }
    const ok = await dialog.confirm({
      title: 'Delete folder',
      message: `Delete folder "${folder}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    deleteFolder.mutate(
      { projectId, folder },
      {
        onError: (e) => toastError(dialog, 'Failed to delete folder', e),
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
        {d.readOnly && !readOnly && (
          <span className="badge badge-readonly" aria-hidden="true">
            read-only
          </span>
        )}
      </button>
    </li>
  );

  const renderFolder = (folder: string): JSX.Element | null => {
    if (isAncestorCollapsed(folder, collapsed)) return null;
    const items = grouped.get(folder) ?? [];
    return (
      <FolderTreeGroup
        key={folder}
        folder={folder}
        items={items}
        collapsed={collapsed.has(folder)}
        depth={folder.split('/').length - 1}
        manageFolders={manageFolders}
        onToggle={toggleCollapsed}
        onDelete={removeFolder}
        renderItem={renderItem}
      />
    );
  };

  return (
    <aside className="project-tree">
      <div className="project-tree-header">
        <h2>Documents</h2>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          title={readOnly ? 'Disable read-only mode before creating documents' : 'New document'}
          disabled={readOnly}
        >
          + New
        </button>
      </div>
      <div className="folder-toolbar">
        <span className="folder-toolbar-label">Folders</span>
        <button
          type="button"
          className="folder-add-btn"
          onClick={addFolder}
          disabled={readOnly}
          title={readOnly ? 'Disable read-only mode before adding folders' : 'Add folder'}
          aria-label="Add folder"
        >
          +
        </button>
        <button
          type="button"
          className={'folder-manage-btn' + (manageFolders ? ' active' : '')}
          onClick={() => setManageFolders((v) => !v)}
          disabled={readOnly}
          aria-pressed={manageFolders}
          title={readOnly ? 'Disable read-only mode before managing folders' : 'Toggle delete buttons'}
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
      {isLoading && <StatusMessage kind="loading">Loading...</StatusMessage>}
      {isError && (
        <StatusMessage kind="error">Failed to load: {error?.message}</StatusMessage>
      )}
      {!isLoading && !isError && (data?.length ?? 0) === 0 && activeFolders.length === 0 && archivedFolders.length === 0 && (
        <StatusMessage kind="empty">No documents yet. Click &quot;+ New&quot; to create one.</StatusMessage>
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
                  {collapsed.has('') ? '>' : 'v'}
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
                {archiveSectionCollapsed ? '>' : 'v'}
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
