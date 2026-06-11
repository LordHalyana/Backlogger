import { useState } from 'react';
import { TagSchema, normalizeTags } from '@backlogger/shared';
import { TagChip } from './TagChip.js';

interface TagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Reusable tag entry control: renders the current tags as removable chips and
 * an input that validates against the shared `TagSchema` before committing.
 * Tag validation stays in `@backlogger/shared` so the rules match the API.
 */
export function TagInput({
  value,
  onChange,
  disabled,
  placeholder = 'Add tag…',
}: TagInputProps): JSX.Element {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const commit = (): void => {
    const raw = input.trim();
    if (!raw) return;
    const parsed = TagSchema.safeParse(raw);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid tag');
      return;
    }
    setError(null);
    setInput('');
    onChange(normalizeTags([...value, parsed.data]));
  };

  const remove = (tag: string): void => {
    onChange(value.filter((t) => t !== tag));
  };

  return (
    <>
      <div className="tag-input-row">
        {value.map((t) => (
          <TagChip key={t} tag={t} onRemove={disabled ? undefined : remove} />
        ))}
        <input
          type="text"
          className="tag-input"
          value={input}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
        />
      </div>
      {error && <span className="tag-error">{error}</span>}
    </>
  );
}
