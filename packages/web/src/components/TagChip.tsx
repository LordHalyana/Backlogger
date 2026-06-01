interface TagChipProps {
  tag: string;
  count?: number;
  active?: boolean;
  onToggle?: (tag: string) => void;
  onRemove?: (tag: string) => void;
}

export function TagChip({ tag, count, active, onToggle, onRemove }: TagChipProps): JSX.Element {
  return (
    <span className={`tag-chip${active ? ' active' : ''}`}>
      <button
        type="button"
        className="tag-chip-label"
        onClick={() => onToggle?.(tag)}
        title={onToggle ? `Filter by ${tag}` : tag}
      >
        {tag}
        {count !== undefined && <span className="tag-chip-count">{count}</span>}
      </button>
      {onRemove && (
        <button
          type="button"
          className="tag-chip-remove"
          onClick={() => onRemove(tag)}
          title={`Remove ${tag}`}
          aria-label={`Remove tag ${tag}`}
        >
          ×
        </button>
      )}
    </span>
  );
}
