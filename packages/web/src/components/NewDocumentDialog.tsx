import { useMemo, useState } from 'react';
import type { Document, DocumentType } from '@backlogger/shared';
import { useCreateDocument } from '../lib/documents.js';
import { useTemplates } from '../lib/templates.js';
import { useFolders, useCreateFolder } from '../lib/folders.js';
import { ApiError } from '../lib/api.js';

interface NewDocumentDialogProps {
  projectId: string;
  onClose: () => void;
  onCreated: (doc: Document) => void;
  /** Pre-select a folder (e.g. when "+ New doc" is clicked on a tree row). */
  initialFolder?: string;
}

const TYPE_OPTIONS: Array<{ value: DocumentType; label: string }> = [
  { value: 'idea', label: 'Idea' },
  { value: 'design_doc', label: 'Design doc' },
  { value: 'implementation_plan', label: 'Implementation plan' },
  { value: 'backlog_item', label: 'Backlog item' },
  { value: 'note', label: 'Note' },
  { value: 'finding', label: 'Finding' },
];

const BLANK = '' as const;
const NEW_FOLDER = '__new__' as const;

export function NewDocumentDialog({
  projectId,
  onClose,
  onCreated,
  initialFolder,
}: NewDocumentDialogProps): JSX.Element {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<DocumentType>('idea');
  const [templateId, setTemplateId] = useState<string>(BLANK);
  const [folder, setFolder] = useState<string>(initialFolder ?? BLANK);
  const [newFolder, setNewFolder] = useState<string>('');
  const create = useCreateDocument(projectId);
  const createFolder = useCreateFolder();
  const folders = useFolders(projectId);
  const templates = useTemplates();

  const availableTemplates = useMemo(
    () => (templates.data ?? []).filter((t) => t.type === type),
    [templates.data, type],
  );

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    let chosenFolder: string | undefined;
    if (folder === NEW_FOLDER) {
      const trimmed = newFolder.trim();
      if (!trimmed) return;
      try {
        const result = await createFolder.mutateAsync({ projectId, folder: trimmed });
        chosenFolder = result.folder;
      } catch {
        return;
      }
    } else if (folder !== BLANK) {
      chosenFolder = folder;
    }
    create.mutate(
      {
        title,
        type,
        template: templateId === BLANK ? undefined : templateId,
        folder: chosenFolder,
      },
      { onSuccess: onCreated },
    );
  };

  const err =
    (create.error instanceof ApiError ? create.error.message : create.error?.message) ??
    (createFolder.error instanceof ApiError
      ? createFolder.error.message
      : createFolder.error?.message);

  const folderList = folders.data ?? [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-doc-dialog-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="new-doc-dialog-title">New Document</h2>
        <form onSubmit={submit}>
          <label>
            Type
            <select
              aria-label="Document type"
              value={type}
              onChange={(e) => {
                setType(e.target.value as DocumentType);
                setTemplateId(BLANK);
              }}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Folder
            <select
              aria-label="Document folder"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
            >
              <option value={BLANK}>Default (by type)</option>
              {folderList.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
              <option value={NEW_FOLDER}>+ New folder…</option>
            </select>
          </label>
          {folder === NEW_FOLDER && (
            <label>
              New folder path
              <input
                type="text"
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                placeholder="e.g. phases/p3/blocks"
                required
              />
            </label>
          )}
          <label>
            Template
            <select
              aria-label="Document template"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value={BLANK}>Blank</option>
              {availableTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {availableTemplates.length === 0 && (
            <small>No templates available for this type.</small>
          )}
          <label>
            Title
            <input
              aria-label="Document title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              required
            />
          </label>
          {err && <p className="error">{err}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={create.isPending || createFolder.isPending || !title}
            >
              {create.isPending || createFolder.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
