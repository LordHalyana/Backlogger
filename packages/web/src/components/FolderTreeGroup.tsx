import type { DocumentSummary } from '@backlogger/shared';

interface FolderTreeGroupProps {
  folder: string;
  items: DocumentSummary[];
  collapsed: boolean;
  depth: number;
  manageFolders: boolean;
  onToggle: (folder: string) => void;
  onDelete: (folder: string) => void;
  renderItem: (doc: DocumentSummary) => React.ReactNode;
}

/**
 * Renders a single folder row plus its document list inside the project tree.
 * The `isAncestorCollapsed` check and collapsed-set management stay in
 * `ProjectTree`; this component only handles the visual output for one folder.
 */
export function FolderTreeGroup({
  folder,
  items,
  collapsed,
  depth,
  manageFolders,
  onToggle,
  onDelete,
  renderItem,
}: FolderTreeGroupProps): JSX.Element {
  const displayName = folder.split('/').pop() ?? folder;

  return (
    <li
      className={'tree-group' + (collapsed ? ' collapsed' : '')}
      style={{ '--folder-depth': depth } as React.CSSProperties}
    >
      <div className="tree-group-label folder-row">
        <button
          type="button"
          className="folder-toggle"
          onClick={() => onToggle(folder)}
          aria-expanded={!collapsed}
          aria-label={(collapsed ? 'Expand' : 'Collapse') + ' folder ' + folder}
          title={folder}
        >
          <span className="folder-caret" aria-hidden="true">
            {collapsed ? '▸' : '▾'}
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
            onClick={() => onDelete(folder)}
            aria-label={`Delete folder ${folder}`}
            title={
              items.length > 0 ? `Folder not empty (${items.length})` : 'Delete folder'
            }
            disabled={items.length > 0}
          >
            ×
          </button>
        )}
      </div>
      {!collapsed && items.length > 0 && <ul>{items.map(renderItem)}</ul>}
    </li>
  );
}
