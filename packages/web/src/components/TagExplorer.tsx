import { useState } from 'react';
import { useTags } from '../lib/tags.js';
import { TagChip } from './TagChip.js';

const MAX_VISIBLE = 20;

interface TagExplorerProps {
  projectId: string;
  selectedTags: readonly string[];
  onToggle: (tag: string) => void;
}

export function TagExplorer({
  projectId,
  selectedTags,
  onToggle,
}: TagExplorerProps): JSX.Element {
  const { data, isLoading, isError } = useTags(projectId);
  const [showAll, setShowAll] = useState(false);

  const tags = data ?? [];
  const visible = showAll ? tags : tags.slice(0, MAX_VISIBLE);
  const hasMore = tags.length > MAX_VISIBLE;

  return (
    <section className="tag-explorer">
      <h3 className="tag-explorer-title">Tags</h3>
      {isLoading && <p className="muted">Loading…</p>}
      {isError && <p className="error">Failed to load tags.</p>}
      {!isLoading && !isError && tags.length === 0 && (
        <p className="muted">No tags yet.</p>
      )}
      {visible.length > 0 && (
        <div className="tag-explorer-chips">
          {visible.map(({ tag, count }) => (
            <TagChip
              key={tag}
              tag={tag}
              count={count}
              active={selectedTags.includes(tag)}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
      {hasMore && (
        <button
          type="button"
          className="tag-explorer-show-more"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? 'Show less' : `Show all ${tags.length}`}
        </button>
      )}
    </section>
  );
}
