import { useState } from 'react';
import type { Project } from '@backlogger/shared';
import {
  useCreateProject,
  useDeleteProject,
  useProjects,
  useUpdateProject,
} from '../lib/projects.js';
import { ApiError } from '../lib/api.js';
import { toastError, useDialog } from '../lib/dialog.js';
import { Modal } from './Modal.js';

interface ProjectSwitcherProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function ProjectSwitcher({ selectedId, onSelect }: ProjectSwitcherProps): JSX.Element {
  const projects = useProjects();
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
        onChange={(e) => onSelect(e.target.value || null)}
        disabled={projects.isLoading}
      >
        <option value="">
          {projects.isLoading
            ? 'Loading...'
            : (projects.data?.length ?? 0) === 0
              ? 'No projects'
              : 'Select a project...'}
        </option>
        {projects.data?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}{p.readOnly ? ' (read-only)' : ''}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => setShowNew(true)}>
        + New Project
      </button>
      {selectedProject && <ProjectReadOnlyToggle project={selectedProject} />}
      {selectedId && (
        <DeleteProjectButton
          id={selectedId}
          name={selectedProject?.name ?? selectedId}
          readOnly={selectedProject?.readOnly ?? false}
          onDeleted={() => onSelect(null)}
        />
      )}
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
      {project.readOnly ? 'Read-only' : 'Editable'}
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

interface DeleteProjectButtonProps {
  id: string;
  name: string;
  readOnly: boolean;
  onDeleted: () => void;
}

function DeleteProjectButton({
  id,
  name,
  readOnly,
  onDeleted,
}: DeleteProjectButtonProps): JSX.Element {
  const del = useDeleteProject();
  const dialog = useDialog();
  const handle = (): void => {
    void dialog
      .prompt({
        title: `Delete project "${name}"`,
        message: `This permanently removes the project and all its documents. Type the project id (${id}) to confirm.`,
        placeholder: id,
        confirmLabel: 'Delete',
        validate: (v) => (v === id ? null : `Type "${id}" to confirm.`),
      })
      .then((typed) => {
        if (typed !== id) return;
        del.mutate(id, {
          onSuccess: onDeleted,
          onError: (e) => toastError(dialog, 'Failed to delete project', e),
        });
      });
  };
  return (
    <button
      type="button"
      className="danger"
      onClick={handle}
      disabled={del.isPending || readOnly}
      title={
        readOnly
          ? 'Disable read-only mode before deleting this project'
          : `Delete project "${name}"`
      }
    >
      Delete
    </button>
  );
}
