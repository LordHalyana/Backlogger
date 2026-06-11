import { useState } from 'react';
import type {
  DocumentType,
  ImportPlacement,
  ImportResult,
} from '@backlogger/shared';
import { useImportFiles } from '../lib/documents.js';
import { ApiError } from '../lib/api.js';
import { Modal, ModalActions } from './Modal.js';

interface ImportDialogProps {
  projectId: string;
  onClose: () => void;
  onImported?: (result: ImportResult) => void;
}

const TYPE_OPTIONS: Array<{ value: DocumentType; label: string }> = [
  { value: 'idea', label: 'Idea' },
  { value: 'design_doc', label: 'Design doc' },
  { value: 'implementation_plan', label: 'Implementation plan' },
  { value: 'backlog_item', label: 'Backlog item' },
  { value: 'note', label: 'Note' },
  { value: 'finding', label: 'Finding' },
];

interface StagedFile {
  filename: string;
  content: string;
  size: number;
}

export function ImportDialog({
  projectId,
  onClose,
  onImported,
}: ImportDialogProps): JSX.Element {
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [readError, setReadError] = useState<string | null>(null);
  const [type, setType] = useState<DocumentType>('note');
  const [titleStrategy, setTitleStrategy] =
    useState<ImportPlacement['titleStrategy']>('frontmatter');
  const [onDuplicate, setOnDuplicate] =
    useState<ImportPlacement['onDuplicate']>('skip');
  const [result, setResult] = useState<ImportResult | null>(null);
  const importMutation = useImportFiles(projectId);

  const onFileInput = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    setReadError(null);
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    if (picked.length > 20) {
      setReadError('Select at most 20 files at a time.');
      return;
    }
    const staged: StagedFile[] = [];
    for (const f of picked) {
      if (!f.name.toLowerCase().endsWith('.md')) {
        setReadError(`"${f.name}" is not a .md file.`);
        return;
      }
      if (f.size > 1_048_576) {
        setReadError(`"${f.name}" is larger than 1 MiB.`);
        return;
      }
      const content = await f.text();
      staged.push({ filename: f.name, content, size: f.size });
    }
    setFiles(staged);
    setResult(null);
  };

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    importMutation.mutate(
      {
        placement: { type, titleStrategy, onDuplicate },
        files: files.map((f) => ({ filename: f.filename, content: f.content })),
      },
      {
        onSuccess: (r) => {
          setResult(r);
          onImported?.(r);
        },
      },
    );
  };

  const apiErr =
    importMutation.error instanceof ApiError
      ? importMutation.error.message
      : importMutation.error?.message;

  return (
    <Modal title="Import Markdown" onClose={onClose}>
      <form onSubmit={submit}>
          <label>
            Files (.md, up to 20, 1 MiB each)
            <input
              type="file"
              accept=".md,text/markdown"
              multiple
              onChange={onFileInput}
            />
          </label>
          {files.length > 0 && (
            <ul className="import-file-list" data-testid="import-staged-files">
              {files.map((f) => (
                <li key={f.filename}>
                  <span>{f.filename}</span>
                  <small>{f.size} bytes</small>
                </li>
              ))}
            </ul>
          )}
          <label>
            Default type (used when a file has no frontmatter)
            <select
              value={type}
              onChange={(e) => setType(e.target.value as DocumentType)}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Title strategy
            <select
              value={titleStrategy}
              onChange={(e) =>
                setTitleStrategy(e.target.value as ImportPlacement['titleStrategy'])
              }
            >
              <option value="frontmatter">Frontmatter title</option>
              <option value="h1">First H1</option>
              <option value="filename">Filename</option>
            </select>
          </label>
          <label>
            On duplicate (matched by frontmatter id)
            <select
              value={onDuplicate}
              onChange={(e) =>
                setOnDuplicate(e.target.value as ImportPlacement['onDuplicate'])
              }
            >
              <option value="skip">Skip</option>
              <option value="copy">Create copy</option>
              <option value="replace">Replace existing</option>
            </select>
          </label>
          {readError && <p className="error">{readError}</p>}
          {apiErr && <p className="error">{apiErr}</p>}
          {result && (
            <div className="import-result" data-testid="import-result">
              <p>
                Imported: {result.imported.length} &middot; Skipped:{' '}
                {result.skipped.length} &middot; Errors: {result.errors.length}
              </p>
              {result.errors.length > 0 && (
                <ul>
                  {result.errors.map((err) => (
                    <li key={err.filename}>
                      <strong>{err.filename}</strong>: {err.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <ModalActions>
            <button type="button" onClick={onClose}>
              {result ? 'Close' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={
                importMutation.isPending || files.length === 0 || result !== null
              }
            >
              {importMutation.isPending ? 'Importing…' : 'Import'}
            </button>
          </ModalActions>
        </form>
    </Modal>
  );
}
