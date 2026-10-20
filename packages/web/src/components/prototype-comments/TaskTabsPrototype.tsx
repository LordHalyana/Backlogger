// PROTOTYPE — throwaway, issue #59. Description / Comments tabs for backlog items,
// plus the floating variant/state switcher. Branch prototype/comments-tab-59 only.
import { useCallback, useEffect, useRef, useState } from 'react';
import { isTextField } from '../../lib/keyboard.js';
import { useDialog } from '../../lib/dialog.js';
import {
  SCENARIOS,
  useCommentsModel,
  type GuardMode,
  type Model,
  type NextOutcome,
  type Scenario,
} from './model.js';
import { VARIANTS } from './variants.js';

export type TaskTab = 'description' | 'comments';

function param(name: string, fallback: string): string {
  return new URL(window.location.href).searchParams.get(name) ?? fallback;
}
function setParam(name: string, value: string): void {
  const u = new URL(window.location.href);
  u.searchParams.set(name, value);
  window.history.replaceState(window.history.state, '', u);
}

interface Props {
  tab: TaskTab;
  onTab: (t: TaskTab) => void;
  description: React.ReactNode;
  metadata: React.ReactNode;
  descriptionDirty: boolean;
  /** Real document flags; scenarios override them for review. */
  archived: boolean;
  readOnly: boolean;
}

export function TaskTabsPrototype(p: Props): JSX.Element {
  const [variant, setVariant] = useState(() => param('variant', 'A'));
  const [scenario, setScenario] = useState<Scenario>(() => {
    const s = param('pcstate', 'live');
    return (SCENARIOS.some((x) => x.key === s) ? s : 'live') as Scenario;
  });
  const [outcome, setOutcome] = useState<NextOutcome>('ok');
  const [guard, setGuard] = useState<GuardMode>(() => param('guard', 'confirm') as GuardMode);
  const [left, setLeft] = useState(false);
  const [persisted, setPersisted] = useState<{ draft: string } | null>(null);
  const [generation, setGeneration] = useState(0);
  const [info, setInfo] = useState<{ count: number; hasDraft: boolean; m: Model | null }>({
    count: 0,
    hasDraft: false,
    m: null,
  });
  const dialog = useDialog();

  const cycle = useCallback((d: 1 | -1) => {
    setVariant((v) => {
      const i = VARIANTS.findIndex((x) => x.key === v);
      const next = VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length]!.key;
      setParam('variant', next);
      return next;
    });
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (isTextField(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      if ((e.target as HTMLElement).closest('[role="tablist"],[role="listbox"]')) return;
      if (e.key === 'ArrowLeft') cycle(-1);
      if (e.key === 'ArrowRight') cycle(1);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [cycle]);

  const leave = (): void => {
    const draft = info.m?.composer.draft ?? '';
    if (!info.hasDraft) return setLeft(true);
    if (guard === 'keep') {
      setPersisted(draft.trim() ? { draft } : null);
      setLeft(true);
      return;
    }
    void dialog
      .confirm({
        title: 'Leave this task?',
        message: 'You have an unsaved comment. Leaving discards it.',
        confirmLabel: 'Discard and leave',
        cancelLabel: 'Stay',
        danger: true,
      })
      .then((ok) => {
        if (!ok) return;
        setPersisted(null);
        setLeft(true);
      });
  };

  const tabs: { key: TaskTab; label: string }[] = [
    { key: 'description', label: 'Description' + (p.descriptionDirty ? ' •' : '') },
    { key: 'comments', label: `Comments (${info.count})` + (info.hasDraft ? ' •' : '') },
  ];
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onTabKey = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next: TaskTab = p.tab === 'description' ? 'comments' : 'description';
    p.onTab(next);
    tabRefs.current[next]?.focus();
  };

  const V = VARIANTS.find((x) => x.key === variant) ?? VARIANTS[0];

  return (
    <>
      <div className="pc-tabs" role="tablist" aria-label="Task sections" onKeyDown={onTabKey}>
        {tabs.map((t) => (
          <button
            key={t.key}
            ref={(el) => (tabRefs.current[t.key] = el)}
            id={`tab-${t.key}`}
            type="button"
            role="tab"
            aria-selected={p.tab === t.key}
            aria-controls={`panel-${t.key}`}
            tabIndex={p.tab === t.key ? 0 : -1}
            className={'pc-tab' + (p.tab === t.key ? ' active' : '')}
            onClick={() => p.onTab(t.key)}
            title={t.label.endsWith('•') ? 'Unsaved draft' : undefined}
          >
            {t.label}
            {t.label.endsWith('•') && <span className="pc-sr-only"> (unsaved draft)</span>}
          </button>
        ))}
      </div>
      <div className="workspace-grid view-split pc-grid">
        <div
          id="panel-description"
          role="tabpanel"
          aria-labelledby="tab-description"
          hidden={p.tab !== 'description'}
          className="pc-panel pc-panel--desc"
        >
          {p.description}
        </div>
        <div
          id="panel-comments"
          role="tabpanel"
          aria-labelledby="tab-comments"
          hidden={p.tab !== 'comments'}
          className="pc-panel"
        >
          {left ? (
            <div className="pc-empty">
              <p>
                You left this task (simulated). {persisted ? 'Your comment draft was kept.' : ''}
              </p>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setLeft(false);
                  setGeneration((g) => g + 1);
                }}
              >
                Return to task
              </button>
            </div>
          ) : (
            <Comments
              key={`${scenario}-${generation}`}
              scenario={scenario}
              outcome={outcome}
              persisted={persisted}
              Variant={V.C}
              onInfo={setInfo}
            />
          )}
        </div>
        {p.metadata}
      </div>

      {import.meta.env.DEV && (
        <div className="pc-switcher" role="region" aria-label="Prototype controls">
          <button type="button" aria-label="Previous variant" onClick={() => cycle(-1)}>
            ←
          </button>
          <strong>
            {V.key} — {V.name}
          </strong>
          <button type="button" aria-label="Next variant" onClick={() => cycle(1)}>
            →
          </button>
          <label>
            State{' '}
            <select
              value={scenario}
              onChange={(e) => {
                const s = e.target.value as Scenario;
                setScenario(s);
                setParam('pcstate', s);
                setLeft(false);
                setPersisted(null);
                p.onTab('comments');
              }}
            >
              {SCENARIOS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Next save{' '}
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as NextOutcome)}>
              <option value="ok">succeeds</option>
              <option value="fail">fails</option>
              <option value="conflict">conflicts</option>
            </select>
          </label>
          <label>
            Leaving with draft{' '}
            <select
              value={guard}
              onChange={(e) => {
                setGuard(e.target.value as GuardMode);
                setParam('guard', e.target.value);
              }}
            >
              <option value="confirm">asks to discard</option>
              <option value="keep">keeps draft</option>
            </select>
          </label>
          <button type="button" onClick={leave} disabled={left}>
            Leave task
          </button>
          <span className="pc-readout" title="Live state">
            {info.m
              ? `composer:${info.m.composer.open ? info.m.composer.phase : 'closed'} edit:${info.m.edit ? info.m.edit.phase : '-'} shown:${info.m.visible.length}/${info.m.comments.length} draft:${info.hasDraft ? 'yes' : 'no'} focus:${info.m.lastFocus || '-'}`
              : ''}
          </span>
        </div>
      )}
    </>
  );
}

function Comments({
  scenario,
  outcome,
  persisted,
  Variant,
  onInfo,
}: {
  scenario: Scenario;
  outcome: NextOutcome;
  persisted: { draft: string } | null;
  Variant: (props: { m: Model }) => JSX.Element;
  onInfo: (i: { count: number; hasDraft: boolean; m: Model }) => void;
}): JSX.Element {
  const m = useCommentsModel(scenario, outcome, persisted);
  const sig = useRef('');
  useEffect(() => {
    const s = [
      m.comments.length,
      m.hasDraft,
      m.composer.open,
      m.composer.phase,
      m.composer.draft,
      m.edit?.phase,
      m.visible.length,
      m.lastFocus,
    ].join('|');
    if (s === sig.current) return;
    sig.current = s;
    onInfo({ count: m.comments.length, hasDraft: m.hasDraft, m });
  });
  return <Variant m={m} />;
}
