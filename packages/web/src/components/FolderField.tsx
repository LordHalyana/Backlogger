import { useState } from 'react';
import { FolderPathSchema } from '@backlogger/shared';
import { useFolders } from '../lib/folders.js';

const BLANK = '';
const NEW_FOLDER = '__new__';

interface FolderFieldProps {
  projectId: string;
  /**
   * Currently selected folder path, or `undefined` for the default (root)
   * placement. Controlled by the parent.
   */
  value: string | undefined;
  onChange: (folder: string | undefined) => void;
  /** Show a "+ New folder…" option that reveals a text input. */
  allowCreate?: boolean;
  placeholder?: string;
}

/**
 * Reusable folder selector used in NewDocumentDialog.
 * Lists existing folders via `useFolders`, optionally exposes a new-folder
 * text input with inline path validation.
 */
export function FolderField({
  projectId,
  value,
  onChange,
  allowCreate = false,
  placeholder,
}: FolderFieldProps): JSX.Element {
  const folders = useFolders(projectId);
  const folderList = folders.data ?? [];

  // Internal select state — initialized from value prop.
  const [selected, setSelected] = useState<string>(value ?? BLANK);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const v = e.target.value;
    setSelected(v);
    if (v === BLANK) {
      onChange(undefined);
    } else if (v === NEW_FOLDER) {
      // Not yet resolved — report undefined until user types a valid name.
      onChange(undefined);
    } else {
      onChange(v);
    }
  };

  const handleNewName = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const v = e.target.value;
    setNewName(v);
    const trimmed = v.trim();
    if (!trimmed) {
      setNameError(null);
      onChange(undefined);
      return;
    }
    const result = FolderPathSchema.safeParse(trimmed);
    if (!result.success) {
      setNameError(
        'Invalid path — use lowercase letters, numbers, hyphens, and forward slashes only.',
      );
      onChange(undefined);
    } else {
      setNameError(null);
      onChange(trimmed);
    }
  };

  return (
    <>
      <label>
        Folder
        <select aria-label="Document folder" value={selected} onChange={handleSelect}>
          <option value={BLANK}>Default (by type)</option>
          {folderList.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
          {allowCreate && <option value={NEW_FOLDER}>+ New folder…</option>}
        </select>
      </label>
      {selected === NEW_FOLDER && (
        <label>
          New folder path
          <input
            type="text"
            value={newName}
            onChange={handleNewName}
            placeholder={placeholder ?? 'e.g. phases/p3/blocks'}
          />
          {nameError && <span className="modal-input-error">{nameError}</span>}
        </label>
      )}
    </>
  );
}
