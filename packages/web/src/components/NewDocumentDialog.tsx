import { useMemo, useState } from 'react';
import {
  DOCUMENT_TYPE_TO_SUBDIR,
  type Document,
  type DocumentType,
} from '@backlogger/shared';
import { useCreateDocument } from '../lib/documents.js';
import { useTemplates } from '../lib/templates.js';
import { useFolders, useCreateFolder } from '../lib/folders.js';
import { ApiError } from '../lib/api.js';
import { Modal, ModalActions } from './Modal.js';
import { FolderField } from './FolderField.js';
import { DOCUMENT_TYPE_LABELS } from '../lib/display.js';

interface NewDocumentDialogProps {
  projectId: string;
  onClose: () => void;
  onCreated: (doc: Document) => void;
  /** Pre-select a folder (e.g. when "+ New doc" is clicked on a tree row). */
  initialFolder?: string;
}

const BLANK = '' as const;

export function NewDocumentDialog({
  projectId,
  onClose,
  onCreated,
  initialFolder,
}: NewDocumentDialogProps): JSX.Element {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<DocumentType>('idea');
  const [templateId, setTemplateId] = useState<string>(BLANK);
  const [folderValue, setFolderValue] = useState<string | undefined>(
    initialFolder ?? DOCUMENT_TYPE_TO_SUBDIR.idea,
  );
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
    let chosenFolder = folderValue;
    if (chosenFolder) {
      const existing = folders.data ?? [];
      if (!existing.includes(chosenFolder)) {
        // Folder name was typed as new — create it first.
        try {
          const result = await createFolder.mutateAsync({ projectId, folder: chosenFolder });
          chosenFolder = result.folder;
        } catch {
          return;
        }
      }
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

  return (
    <Modal title="New Document" onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          Type
          <select
            aria-label="Document type"
            value={type}
            onChange={(e) => {
              const nextType = e.target.value as DocumentType;
              setType(nextType);
              setTemplateId(BLANK);
              setFolderValue((current) =>
                current === DOCUMENT_TYPE_TO_SUBDIR[type]
                  ? DOCUMENT_TYPE_TO_SUBDIR[nextType]
                  : current,
              );
            }}
          >
            {(Object.entries(DOCUMENT_TYPE_LABELS) as Array<[DocumentType, string]>).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ),
            )}
          </select>
        </label>
        <FolderField
          projectId={projectId}
          value={folderValue}
          onChange={setFolderValue}
          allowCreate
          placeholder="e.g. phases/p3/blocks"
        />
        <small>The default folder is selected from the document type. Choose another folder when needed.</small>
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
        <ModalActions>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending || createFolder.isPending || !title}
          >
            {create.isPending || createFolder.isPending ? 'Creating…' : 'Create'}
          </button>
        </ModalActions>
      </form>
    </Modal>
  );
}
