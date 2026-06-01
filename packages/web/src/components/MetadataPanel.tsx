import { useState } from 'react';
import { type DocumentStatus, TagSchema, normalizeTags } from '@backlogger/shared';
import { useBacklinks } from '../lib/links.js';
import { TagChip } from './TagChip.js';

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
  onOpenDocument?: (projectId: string, documentId: string) => void;
}

const STATUS_OPTIONS: DocumentStatus[] = ['draft', 'active', 'archived'];

export function MetadataPanel({
  value,
  onChange,
  documentPath,
  documentId,
  updatedAt,
  onDelete,
  deleting,
  onOpenDocument,
}: MetadataPanelProps): JSX.Element {
  const backlinks = useBacklinks(documentId);
  const [tagInput, setTagInput] = useState('');
  const [tagError, setTagError] = useState<string | null>(null);

  const commitTagInput = (): void => {
    const raw = tagInput.trim();
    if (!raw) return;
    const parsed = TagSchema.safeParse(raw);
    if (!parsed.success) {
      setTagError(parsed.error.issues[0]?.message ?? 'Invalid tag');
      return;
    }
    setTagError(null);
    const next = normalizeTags([...value.tags, parsed.data]);
    setTagInput('');
    onChange({ ...value, tags: next });
  };

  const removeTag = (tag: string): void => {
    onChange({ ...value, tags: value.tags.filter((t) => t !== tag) });
  };

  return (
    <section className="metadata-panel">
      <h3>Metadata</h3>
      <label>
        Title
        <input
          type="text"
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
        />
      </label>
      <label>
        Status
        <select
          value={value.status}
          onChange={(e) => onChange({ ...value, status: e.target.value as DocumentStatus })}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tags
        <div className="tag-input-row">
          {value.tags.map((t) => (
            <TagChip key={t} tag={t} onRemove={removeTag} />
          ))}
          <input
            type="text"
            className="tag-input"
            value={tagInput}
            placeholder="Add tag…"
            onChange={(e) => {
              setTagInput(e.target.value);
              setTagError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                commitTagInput();
              }
            }}
            onBlur={commitTagInput}
          />
        </div>
        {tagError && <span className="tag-error">{tagError}</span>}
      </label>
      <dl className="metadata-info">
        <dt>Path</dt>
        <dd>
          <code>{documentPath}</code>
        </dd>
        <dt>Updated</dt>
        <dd>{new Date(updatedAt).toLocaleString()}</dd>
      </dl>
      <button type="button" className="danger" onClick={onDelete} disabled={deleting}>
        {deleting ? 'Deleting…' : 'Delete document'}
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
