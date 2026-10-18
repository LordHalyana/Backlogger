import {
  taskStateColumn,
  TASK_STATES,
  TASK_STATE_LABELS,
  type TaskState,
} from '@backlogger/shared';

interface TaskStateSelectProps {
  title: string;
  /** The stored value, verbatim; unrecognised values show as To do. */
  value: string | null;
  disabled?: boolean;
  onChange: (next: TaskState) => void;
}

/** Change a backlog item's task state in place. */
export function TaskStateSelect({
  title,
  value,
  disabled,
  onChange,
}: TaskStateSelectProps): JSX.Element {
  return (
    <select
      className="task-state-select"
      aria-label={`Task state of “${title}”`}
      disabled={disabled}
      value={taskStateColumn(value)}
      onChange={(e) => onChange(e.target.value as TaskState)}
    >
      {TASK_STATES.map((state) => (
        <option key={state} value={state}>
          {TASK_STATE_LABELS[state]}
        </option>
      ))}
    </select>
  );
}
