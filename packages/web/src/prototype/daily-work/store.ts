// PROTOTYPE — throwaway. Lives on branch prototype/daily-work-interface only.
//
// In-memory stand-in for the server side of the daily-work milestone:
// capture, Inbox filing, task-state change and the derived Current work view.
// Nothing is persisted and nothing talks to the real API. The point is to make
// the interface states (pending, failed, retried, conflicted, read-only)
// reachable on demand from the prototype bar.

import { useEffect, useState, useSyncExternalStore } from 'react';

export type TaskState = 'todo' | 'in_progress' | 'done';
export type DocStatus = 'draft' | 'active' | 'archived';

export interface Project {
  id: string;
  name: string;
  readOnly: boolean;
  /** The designated Inbox. Name alone never makes a project the Inbox. */
  inbox?: boolean;
  created_at: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  body: string;
  task_state: TaskState;
  status: DocStatus;
  readOnly: boolean;
  created_at: string;
  revision: number;
}

/**
 * How the next server calls behave:
 * - normal: ~300 ms, succeeds
 * - slow: ~2.5 s, succeeds (shows pending / loading states)
 * - offline: fails before anything is written
 * - lost-response: the write IS applied, but the response never arrives
 *   (interrupted operation; a retry must not duplicate)
 * - reject: the server refuses the write (e.g. disk / validation error)
 */
export type Sim = 'normal' | 'slow' | 'offline' | 'lost-response' | 'reject';
export type Scenario = 'lived-in' | 'fresh';

export interface StoreState {
  scenario: Scenario;
  sim: Sim;
  projects: Project[];
  tasks: Task[];
  /** Retry protection: capture request id → created task id. */
  requests: Record<string, string>;
  log: string[];
}

export class ProtoError extends Error {
  constructor(
    public kind: 'network' | 'conflict' | 'read-only' | 'rejected' | 'not-found',
    message: string,
  ) {
    super(message);
  }
}

let seq = 100;
const nextId = (prefix: string): string => `${prefix}-${(seq++).toString(36)}`;
const iso = (daysAgo: number, h = 9): string =>
  new Date(Date.UTC(2026, 9, 18 - daysAgo, h)).toISOString();

function seed(scenario: Scenario): Pick<StoreState, 'projects' | 'tasks'> {
  const projects: Project[] = [
    { id: 'backlogger', name: 'Backlogger', readOnly: false, created_at: iso(140) },
    { id: 'home-system', name: 'Home System', readOnly: true, created_at: iso(130) },
    { id: 'notes-for-myself', name: 'Notes for myself', readOnly: false, created_at: iso(90) },
    { id: 'portfolio-page', name: 'Portfolio Page', readOnly: false, created_at: iso(60) },
  ];
  const t = (
    id: string,
    projectId: string,
    title: string,
    task_state: TaskState,
    daysAgo: number,
    extra: Partial<Task> = {},
  ): Task => ({
    id,
    projectId,
    title,
    body: extra.body ?? `Notes for “${title}”.`,
    task_state,
    status: 'active',
    readOnly: false,
    created_at: iso(daysAgo),
    revision: 1,
    ...extra,
  });
  const tasks: Task[] = [
    t('bl-1', 'backlogger', 'Ship the first Kanban board', 'done', 30),
    t(
      'bl-2',
      'backlogger',
      'Verify autosave fix on main before editor integration',
      'in_progress',
      6,
      {
        body: 'Check merged #22 result. HelpDrawer test still stale?',
      },
    ),
    t('bl-3', 'backlogger', 'Prototype capture-to-Current-work interface', 'in_progress', 2, {
      body: 'Three variants; scenario bar for failures. Review with keyboard only.',
    }),
    t('bl-4', 'backlogger', 'Decide public readiness checks', 'todo', 2),
    t('bl-5', 'backlogger', 'Write daily-work specification', 'todo', 1, { status: 'draft' }),
    t('bl-6', 'backlogger', 'Old spike: sidecar boards', 'in_progress', 40, { status: 'archived' }),
    t('hs-1', 'home-system', 'Replace NAS fan', 'in_progress', 12, {
      readOnly: true,
      body: 'Noctua 92mm, check RPM header.',
    }),
    t('nm-1', 'notes-for-myself', 'Re-read whitepaper v0.1 “Daily use”', 'in_progress', 3, {
      status: 'draft',
      body: 'Markdown as the durable record; local-release acceptance criteria.',
    }),
    t('pp-1', 'portfolio-page', 'Swap hero image', 'todo', 20),
  ];
  if (scenario === 'lived-in') {
    projects.push({
      id: 'inbox',
      name: 'Inbox',
      readOnly: false,
      inbox: true,
      created_at: iso(10),
    });
    tasks.push(
      t('in-1', 'inbox', 'Look into weather widget idea', 'todo', 4, { status: 'draft' }),
      t('in-2', 'inbox', 'Call about router warranty', 'todo', 1, { status: 'draft' }),
      t('in-3', 'inbox', 'Try keyboard-only triage', 'in_progress', 1, { status: 'draft' }),
    );
  } else {
    // An ordinary project that merely happens to be called "Inbox".
    projects.push({ id: 'old-inbox', name: 'Inbox', readOnly: false, created_at: iso(200) });
  }
  return { projects, tasks };
}

function initial(scenario: Scenario, sim: Sim = 'normal'): StoreState {
  return { scenario, sim, ...seed(scenario), requests: {}, log: [`seeded “${scenario}” scenario`] };
}

let state: StoreState = initial('lived-in');
const listeners = new Set<() => void>();

function set(fn: (s: StoreState) => StoreState): void {
  state = fn(state);
  listeners.forEach((l) => l());
}

function log(line: string): void {
  set((s) => ({
    ...s,
    log: [`${new Date().toLocaleTimeString()} ${line}`, ...s.log].slice(0, 40),
  }));
}

export function useStore(): StoreState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const controls = {
  setSim: (sim: Sim): void => set((s) => ({ ...s, sim })),
  reset: (scenario: Scenario): void => {
    set((s) => initial(scenario, s.sim));
    window.dispatchEvent(new Event('proto-reset'));
  },
  /** Another tab marks one In progress task Done; open views stay stale until reload. */
  otherTabCompletes: (): void => {
    const victim = state.tasks.find(
      (t) => t.task_state === 'in_progress' && t.status !== 'archived' && !t.readOnly,
    );
    if (!victim) return log('other tab: nothing In progress to complete');
    set((s) => ({
      ...s,
      tasks: s.tasks.map((t) =>
        t.id === victim.id ? { ...t, task_state: 'done', revision: t.revision + 1 } : t,
      ),
    }));
    log(`other tab: “${victim.title}” → Done (rev ${victim.revision + 1}); views not told`);
  },
};

// ---------------------------------------------------------------- selectors

export const inboxOf = (s: StoreState): Project | undefined => s.projects.find((p) => p.inbox);
export const projectOf = (s: StoreState, id: string): Project | undefined =>
  s.projects.find((p) => p.id === id);
export const isReadOnly = (s: StoreState, t: Task): boolean =>
  t.readOnly || (projectOf(s, t.projectId)?.readOnly ?? false);

/** Projects in display order: Inbox first, then by name. */
export function orderedProjects(s: StoreState): Project[] {
  return [...s.projects].sort((a, b) =>
    a.inbox ? -1 : b.inbox ? 1 : a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

const byCreation = (a: Task, b: Task): number =>
  a.created_at === b.created_at
    ? a.id.localeCompare(b.id)
    : a.created_at.localeCompare(b.created_at);

export function boardTasks(s: StoreState, projectId: string): Task[] {
  return s.tasks
    .filter((t) => t.projectId === projectId && t.status !== 'archived')
    .sort(byCreation);
}

export interface CurrentGroup {
  project: Project;
  tasks: Task[];
}

/** The derived Current work view (decision #34): In progress, non-archived, grouped. */
export function deriveCurrentWork(s: StoreState): CurrentGroup[] {
  return orderedProjects(s)
    .map((project) => ({
      project,
      tasks: s.tasks
        .filter(
          (t) =>
            t.projectId === project.id && t.task_state === 'in_progress' && t.status !== 'archived',
        )
        .sort(byCreation),
    }))
    .filter((g) => g.tasks.length > 0);
}

// ---------------------------------------------------------- simulated server

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function call<T>(name: string, apply: () => T): Promise<T> {
  const sim = state.sim;
  await wait(sim === 'slow' ? 2500 : 300);
  if (sim === 'offline') {
    log(`${name}: ✗ server unreachable, nothing written`);
    throw new ProtoError('network', 'Backlogger server is not reachable. Nothing was saved.');
  }
  if (sim === 'reject') {
    log(`${name}: ✗ write rejected by server`);
    throw new ProtoError('rejected', 'The server could not write the file. Nothing was saved.');
  }
  const result = apply();
  if (sim === 'lost-response') {
    log(`${name}: ✓ applied on server, ✗ response lost`);
    throw new ProtoError('network', 'The connection dropped before the server answered.');
  }
  return result;
}

export interface CaptureArgs {
  requestId: string;
  title: string;
  /** null = global quick capture → the designated Inbox. */
  projectId: string | null;
}

export function capture({ requestId, title, projectId }: CaptureArgs): Promise<Task> {
  return call('capture', () => {
    const existing = state.requests[requestId];
    if (existing) {
      const task = state.tasks.find((t) => t.id === existing)!;
      log(`capture: request ${requestId} already done → returning ${task.id}, no duplicate`);
      return task;
    }
    let target = projectId ? projectOf(state, projectId) : inboxOf(state);
    if (!target) {
      target = {
        id: nextId('inbox'),
        name: 'Inbox',
        readOnly: false,
        inbox: true,
        created_at: new Date().toISOString(),
      };
      const created = target;
      set((s) => ({ ...s, projects: [...s.projects, created] }));
      log(`capture: no designated Inbox → created ${created.id}`);
    }
    if (target.readOnly) throw new ProtoError('read-only', `${target.name} is read-only.`);
    const task: Task = {
      id: nextId('task'),
      projectId: target.id,
      title,
      body: '',
      task_state: 'todo',
      status: 'draft',
      readOnly: false,
      created_at: new Date().toISOString(),
      revision: 1,
    };
    set((s) => ({
      ...s,
      tasks: [...s.tasks, task],
      requests: { ...s.requests, [requestId]: task.id },
    }));
    log(`capture: created ${task.id} “${title}” in ${target.name} (request ${requestId})`);
    return task;
  });
}

function guard(taskId: string, revision: number): Task {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) throw new ProtoError('not-found', 'This task no longer exists.');
  if (isReadOnly(state, task)) throw new ProtoError('read-only', 'This task is read-only.');
  if (task.revision !== revision)
    throw new ProtoError(
      'conflict',
      'This task was changed somewhere else, so your change was not saved.',
    );
  return task;
}

function patch(taskId: string, changes: Partial<Task>): Task {
  let out!: Task;
  set((s) => ({
    ...s,
    tasks: s.tasks.map((t) =>
      t.id === taskId ? (out = { ...t, ...changes, revision: t.revision + 1 }) : t,
    ),
  }));
  return out;
}

/** Same-ID filing into another writable native project. */
export function fileTask(taskId: string, revision: number, toProjectId: string): Promise<Task> {
  return call('file', () => {
    const task = guard(taskId, revision);
    const to = projectOf(state, toProjectId);
    if (!to) throw new ProtoError('not-found', 'That project no longer exists.');
    if (to.readOnly) throw new ProtoError('read-only', `${to.name} is read-only.`);
    log(`file: ${task.id} ${projectOf(state, task.projectId)?.name} → ${to.name} (same id)`);
    return patch(taskId, { projectId: to.id });
  });
}

export function setTaskState(taskId: string, revision: number, to: TaskState): Promise<Task> {
  return call('task state', () => {
    const task = guard(taskId, revision);
    log(`task state: ${task.id} ${task.task_state} → ${to}`);
    return patch(taskId, { task_state: to });
  });
}

export function archiveTask(taskId: string, revision: number): Promise<Task> {
  return call('archive', () => {
    const task = guard(taskId, revision);
    log(`archive: ${task.id}`);
    return patch(taskId, { status: 'archived' });
  });
}

export function editBody(taskId: string, body: string): void {
  set((s) => ({ ...s, tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, body } : t)) }));
}

// ---------------------------------------------------------------- client hooks

/**
 * Current work as a client snapshot: loads on open, on window focus and after
 * the view's own changes — never live. Lets the stale-then-conflict path happen.
 */
export function useCurrentWork(): {
  groups: CurrentGroup[] | null;
  loading: boolean;
  reload: () => void;
} {
  const [groups, setGroups] = useState<CurrentGroup[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    wait(state.sim === 'slow' ? 2500 : 250).then(() => {
      if (!live) return;
      if (state.sim === 'offline') {
        setGroups(null);
      } else {
        setGroups(deriveCurrentWork(state));
        log('current work: reloaded snapshot');
      }
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [tick]);
  useEffect(() => {
    const bump = (): void => setTick((n) => n + 1);
    window.addEventListener('focus', bump);
    window.addEventListener('proto-reset', bump);
    return () => {
      window.removeEventListener('focus', bump);
      window.removeEventListener('proto-reset', bump);
    };
  }, []);
  return { groups, loading, reload: () => setTick((n) => n + 1) };
}

export const newRequestId = (): string => `req-${Math.random().toString(36).slice(2, 8)}`;

/** Capture form state: the request id survives a failure so a retry is the same request. */
export function useCapture(defaultProjectId: string | null): {
  title: string;
  setTitle: (v: string) => void;
  dest: string | null;
  setDest: (v: string | null) => void;
  requestId: string;
  pending: boolean;
  error: string | null;
  created: Task | null;
  submit: () => Promise<Task | null>;
  clearCreated: () => void;
} {
  const [title, setTitle] = useState('');
  const [dest, setDest] = useState<string | null>(defaultProjectId);
  const [requestId, setRequestId] = useState(newRequestId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Task | null>(null);
  useEffect(() => setDest(defaultProjectId), [defaultProjectId]);
  return {
    title,
    setTitle: (v) => {
      setTitle(v);
      setError(null);
    },
    dest,
    setDest,
    requestId,
    pending,
    error,
    created,
    clearCreated: () => setCreated(null),
    submit: async () => {
      const clean = title.trim();
      if (!clean || pending) return null;
      setPending(true);
      setError(null);
      try {
        const task = await capture({ requestId, title: clean, projectId: dest });
        setCreated(task);
        setTitle('');
        setRequestId(newRequestId());
        return task;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setPending(false);
      }
    },
  };
}

/** Run a task mutation with per-task pending + error, as the board does. */
export function useTaskAction(onDone?: () => void): {
  busy: ReadonlySet<string>;
  error: { taskId: string; message: string; kind: ProtoError['kind'] } | null;
  run: (taskId: string, fn: () => Promise<unknown>) => Promise<boolean>;
  dismiss: () => void;
} {
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<{
    taskId: string;
    message: string;
    kind: ProtoError['kind'];
  } | null>(null);
  return {
    busy,
    error,
    dismiss: () => setError(null),
    run: async (taskId, fn) => {
      setBusy((b) => new Set(b).add(taskId));
      setError(null);
      try {
        await fn();
        return true;
      } catch (e) {
        const err = e as ProtoError;
        setError({ taskId, message: err.message, kind: err.kind ?? 'rejected' });
        return false;
      } finally {
        setBusy((b) => {
          const n = new Set(b);
          n.delete(taskId);
          return n;
        });
        onDone?.();
      }
    },
  };
}
