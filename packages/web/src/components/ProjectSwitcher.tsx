import { useEffect, useRef, useState } from 'react';
import type { Project } from '@backlogger/shared';
import {
  useCreateProject,
  useDeleteProject,
  useProjects,
  useUpdateProject,
} from '../lib/projects.js';
import { ApiError } from '../lib/api.js';
import { toastError, useDialog } from '../lib/dialog.js';
import { orderProjects } from '../lib/inbox.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { Modal } from './Modal.js';
import { Icon } from './Icon.js';

interface ProjectSwitcherProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Narrow widths only, where the rail folds into this switcher. */
  onCapture?: () => void;
  onOpenTriage?: () => void;
  onToggleCurrentWork?: () => void;
}

/** Below this width the workspace rail is hidden and its entries live here. */
export const NARROW_QUERY = '(max-width: 900px)';

const CAPTURE_ENTRY = '__capture';
const TRIAGE_ENTRY = '__triage';
const CURRENT_WORK_ENTRY = '__current-work';

export function ProjectSwitcher({
  selectedId,
  onSelect,
  onCapture,
  onOpenTriage,
  onToggleCurrentWork,
}: ProjectSwitcherProps): JSX.Element {
  const projects = useProjects();
  const narrow = useMediaQuery(NARROW_QUERY);
  const [showNew, setShowNew] = useState(false);
  const selectedProject = projects.data?.find((p) => p.id === selectedId);

  return (
    <div className="project-switcher">
      <label htmlFor="project-select" className="visually-hidden">
        Project
      </label>
      <select
        id="project-select"
        value={selectedId ?? ''}
        onChange={(e) => {
          const value = e.target.value;
          if (value === CAPTURE_ENTRY) onCapture?.();
          else if (value === TRIAGE_ENTRY) onOpenTriage?.();
          else if (value === CURRENT_WORK_ENTRY) onToggleCurrentWork?.();
          else onSelect(value || null);
        }}
        disabled={projects.isLoading}
      >
        <option value="">
          {projects.isLoading
            ? 'Loading...'
            : (projects.data?.length ?? 0) === 0
              ? 'No projects'
              : 'Select a project...'}
        </option>
        {orderProjects(projects.data ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.isInbox ? '⌂ ' : ''}
            {p.name}{p.readOnly ? ' (read-only)' : ''}
          </option>
        ))}
        {narrow && (
          <optgroup label="Daily work">
            <option value={CAPTURE_ENTRY}>+ Capture…</option>
            <option value={TRIAGE_ENTRY}>⌂ Inbox triage</option>
            <option value={CURRENT_WORK_ENTRY}>Current work</option>
          </optgroup>
        )}
      </select>
      <button type="button" onClick={() => setShowNew(true)}>
        + New Project
      </button>
      {selectedProject && !selectedProject.isInbox && (
        <ProjectReadOnlyToggle project={selectedProject} />
      )}
      {selectedProject && !selectedProject.isInbox && (
        <ProjectMetadataModeToggle project={selectedProject} />
      )}
      <ProjectMenu
        projectId={selectedId}
        projectName={selectedProject?.name ?? selectedId ?? ''}
        readOnly={selectedProject?.readOnly ?? false}
        isInbox={selectedProject?.isInbox ?? false}
        onDeleted={() => onSelect(null)}
      />
      {showNew && (
        <NewProjectDialog
          onClose={() => setShowNew(false)}
          onCreated={(p) => {
            setShowNew(false);
            onSelect(p.id);
          }}
        />
      )}
    </div>
  );
}

function ProjectReadOnlyToggle({ project }: { project: Project }): JSX.Element {
  const update = useUpdateProject();
  const dialog = useDialog();
  const nextReadOnly = !project.readOnly;
  return (
    <button
      type="button"
      className={project.readOnly ? 'readonly-toggle locked' : 'readonly-toggle'}
      onClick={() =>
        update.mutate(
          { id: project.id, input: { readOnly: nextReadOnly } },
          { onError: (e) => toastError(dialog, 'Failed to update project mode', e) },
        )
      }
      disabled={update.isPending}
      title={
        project.readOnly
          ? 'Read-only mode is enabled. Click to allow edits in this project.'
          : 'Edits are enabled. Click to protect this project from writes.'
      }
      aria-pressed={project.readOnly}
    >
      <Icon name="lock" />
      {project.readOnly ? 'Read-only' : 'Editable'}
    </button>
  );
}

function ProjectMetadataModeToggle({ project }: { project: Project }): JSX.Element {
  const update = useUpdateProject();
  const dialog = useDialog();
  const sidecar = project.metadataMode === 'sidecar';
  const next = sidecar ? 'frontmatter' : 'sidecar';
  return (
    <button
      type="button"
      className={sidecar ? 'metadata-mode-toggle sidecar' : 'metadata-mode-toggle'}
      onClick={() => {
        void dialog
          .confirm({
            title: 'Switch metadata mode',
            message: sidecar
              ? 'Switch to frontmatter mode? New documents and edits will write Backlogger frontmatter into the files themselves.'
              : 'Switch to sidecar mode? Backlogger metadata is stored in .backlogger/index.json so source files stay frontmatter-free. Existing frontmatter documents keep their frontmatter.',
            confirmLabel: 'Switch',
          })
          .then((ok) => {
            if (!ok) return;
            update.mutate(
              { id: project.id, input: { metadataMode: next } },
              { onError: (e) => toastError(dialog, 'Failed to change metadata mode', e) },
            );
          });
      }}
      disabled={update.isPending}
      title={
        sidecar
          ? 'Sidecar mode: metadata lives in .backlogger/, source files stay frontmatter-free. Click to use frontmatter.'
          : 'Frontmatter mode: metadata is written into each file. Click to store it in a sidecar instead.'
      }
      aria-pressed={sidecar}
    >
      <Icon name="file" />
      {sidecar ? 'Sidecar' : 'Frontmatter'}
    </button>
  );
}

interface NewProjectDialogProps {
  onClose: () => void;
  onCreated: (project: Project) => void;
}

function NewProjectDialog({ onClose, onCreated }: NewProjectDialogProps): JSX.Element {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = useCreateProject();

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    create.mutate(
      {
        id,
        name,
        description: description.trim() || undefined,
      },
      { onSuccess: onCreated },
    );
  };

  const err = create.error instanceof ApiError ? create.error.message : create.error?.message;

  return (
    <Modal title="New Project" onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          ID
          <input
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="home-system"
            autoFocus
            required
          />
          <small>kebab-case, used as the folder name on disk</small>
        </label>
        <label>
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Home System"
            required
          />
        </label>
        <label>
          Description (optional)
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </label>
        {err && <p className="error">{err}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={create.isPending || !id || !name}>
            {create.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface ProjectMenuProps {
  projectId: string | null;
  projectName: string;
  readOnly: boolean;
  /** The designated Inbox cannot be deleted. */
  isInbox: boolean;
  onDeleted: () => void;
}

/** Overflow (⋮) menu for less-common, destructive project actions. */
function ProjectMenu({
  projectId,
  projectName,
  readOnly,
  isInbox,
  onDeleted,
}: ProjectMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const del = useDeleteProject();
  const dialog = useDialog();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleDelete = (): void => {
    setOpen(false);
    if (!projectId) return;
    void dialog
      .prompt({
        title: `Delete project "${projectName}"`,
        message: `This permanently removes the project and all its documents. Type the project id (${projectId}) to confirm.`,
        placeholder: projectId,
        confirmLabel: 'Delete',
        validate: (v) => (v === projectId ? null : `Type "${projectId}" to confirm.`),
      })
      .then((typed) => {
        if (typed !== projectId) return;
        del.mutate(projectId, {
          onSuccess: onDeleted,
          onError: (e) => toastError(dialog, 'Failed to delete project', e),
        });
      });
  };

  return (
    <div className="project-menu" ref={ref}>
      <button
        type="button"
        className="project-menu-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Project actions"
        title="Project actions"
      >
        <Icon name="dots" />
      </button>
      {open && (
        <div className="project-menu-popover" role="menu">
          <button
            type="button"
            role="menuitem"
            className="project-menu-item project-menu-item--danger"
            onClick={handleDelete}
            disabled={!projectId || readOnly || isInbox || del.isPending}
            title={
              isInbox
                ? 'The Inbox cannot be deleted'
                : readOnly
                  ? 'Disable read-only mode before deleting this project'
                  : undefined
            }
          >
            <Icon name="trash" />
            Delete project
          </button>
        </div>
      )}
    </div>
  );
}
