import { type DocumentStatus } from '@backlogger/shared';
import { useBacklinks } from '../lib/links.js';
import { TagInput } from './TagInput.js';
import { DOCUMENT_STATUS_LABELS } from '../lib/display.js';

export interface MetadataPanelValue {
  title: string;
  status: DocumentStatus;
  tags: string[];
}

interface MetadataPanelProps {
  value: MetadataPanelValue;
  onChange: (next: MetadataPanelValue) => void;
  documentPath: string;
  documentId: string;
  updatedAt: string;
  onDelete: () => void;
  deleting?: boolean;
  readOnly?: boolean;
  onOpenDocument?: (projectId: string, documentId: string) => void;
}


export function MetadataPanel({
  value,
  onChange,
  documentPath,
  documentId,
  updatedAt,
  onDelete,
  deleting,
  readOnly = false,
  onOpenDocument,
}: MetadataPanelProps): JSX.Element {
  const backlinks = useBacklinks(documentId);

  return (
    <section className="metadata-panel">
      <h3>Metadata</h3>
      {readOnly && (
        <p className="metadata-readonly">
          Read-only derived document. Add Backlogger frontmatter to edit it.
        </p>
      )}
      <label>
        Title
        <input
          type="text"
          value={value.title}
          disabled={readOnly}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
        />
      </label>
      <label>
        Status
        <select
          value={value.status}
          disabled={readOnly}
          onChange={(e) => onChange({ ...value, status: e.target.value as DocumentStatus })}
        >
          {(Object.entries(DOCUMENT_STATUS_LABELS) as Array<[DocumentStatus, string]>).map(
            ([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ),
          )}
        </select>
      </label>
      <label>
        Tags
        <TagInput
          value={value.tags}
          disabled={readOnly}
          onChange={(tags) => onChange({ ...value, tags })}
        />
      </label>
      <dl className="metadata-info">
        <dt>Path</dt>
        <dd>
          <code>{documentPath}</code>
        </dd>
        <dt>Updated</dt>
        <dd>{new Date(updatedAt).toLocaleString()}</dd>
      </dl>
      <button type="button" className="danger" onClick={onDelete} disabled={deleting || readOnly}>
        {deleting ? 'Deleting…' : 'Delete document'}
      </button>
      <button
        type="button"
        className={value.status === 'archived' ? 'archive-toggle archive-toggle--restore' : 'archive-toggle'}
        disabled={readOnly}
        onClick={() =>
          onChange({
            ...value,
            status: value.status === 'archived' ? 'active' : 'archived',
          })
        }
      >
        {value.status === 'archived' ? 'Unarchive' : 'Archive'}
      </button>
      <details className="backlinks" open>
        <summary>
          Backlinks
          {backlinks.data ? <span className="backlinks-count"> ({backlinks.data.length})</span> : null}
        </summary>
        {backlinks.isLoading ? (
          <p className="backlinks-empty">Loading…</p>
        ) : backlinks.data && backlinks.data.length > 0 ? (
          <ul className="backlinks-list">
            {backlinks.data.map((b) => (
              <li key={`${b.id}:${b.position}`} className="backlinks-row">
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onOpenDocument?.(b.project_id, b.id)}
                  title={`Open ${b.title}`}
                >
                  {b.title}
                </button>
                <span className="backlinks-display"> · “{b.display}”</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="backlinks-empty">No backlinks yet.</p>
        )}
      </details>
    </section>
  );
}
