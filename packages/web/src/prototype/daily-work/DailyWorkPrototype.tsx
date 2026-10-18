// PROTOTYPE — throwaway. Mounted at /prototype/daily-work?variant=A|B|C in dev only.
// Plan: three variants of the daily-work flow (capture → Inbox triage →
// Current work → open/search), switchable via ?variant=, over an in-memory store.

import { useEffect, useState } from 'react';
import { PrototypeSwitcher, readVariant } from '../../components/PrototypeSwitcher.js';
import { controls, useStore, type Scenario, type Sim } from './store.js';
import { VARIANTS } from './variants.js';
import './prototype.css';

const KEYS = VARIANTS.map((v) => v.key);

export function DailyWorkPrototype(): JSX.Element {
  const [variant, setVariant] = useState(() => readVariant(KEYS));
  const [resetN, setResetN] = useState(0);
  const [showState, setShowState] = useState(false);
  const s = useStore();
  useEffect(() => {
    const h = (): void => setResetN((n) => n + 1);
    window.addEventListener('proto-reset', h);
    return () => window.removeEventListener('proto-reset', h);
  }, []);
  const { Component } = VARIANTS.find((v) => v.key === variant)!;

  return (
    <>
      <Component key={`${variant}-${resetN}`} />
      {showState && (
        <aside className="proto-state" aria-label="Prototype state">
          <h3>Server state (in memory)</h3>
          <pre>
            {JSON.stringify(
              {
                sim: s.sim,
                projects: s.projects.map(
                  (p) =>
                    `${p.id}${p.inbox ? ' [INBOX]' : ''}${p.readOnly ? ' [ro]' : ''} “${p.name}”`,
                ),
                tasks: s.tasks.map(
                  (t) =>
                    `${t.id} @${t.projectId} ${t.task_state}/${t.status} r${t.revision} “${t.title}”`,
                ),
                requests: s.requests,
              },
              null,
              1,
            )}
          </pre>
          <h3>Log</h3>
          <pre>{s.log.join('\n')}</pre>
        </aside>
      )}
      <PrototypeSwitcher variants={VARIANTS} current={variant} onChange={setVariant}>
        <span className="proto-switcher-sep" />
        <label>
          Server{' '}
          <select value={s.sim} onChange={(e) => controls.setSim(e.target.value as Sim)}>
            <option value="normal">normal</option>
            <option value="slow">slow (2.5 s)</option>
            <option value="offline">offline</option>
            <option value="lost-response">interrupted (write applied, reply lost)</option>
            <option value="reject">rejects writes</option>
          </select>
        </label>
        <label>
          Data{' '}
          <select value={s.scenario} onChange={(e) => controls.reset(e.target.value as Scenario)}>
            <option value="lived-in">lived-in</option>
            <option value="fresh">fresh (no Inbox yet)</option>
          </select>
        </label>
        <button
          type="button"
          onClick={controls.otherTabCompletes}
          title="Another tab marks an In progress task Done"
        >
          Other tab: done
        </button>
        <button type="button" onClick={() => controls.reset(s.scenario)}>
          Reset
        </button>
        <button type="button" onClick={() => setShowState((v) => !v)}>
          {showState ? 'Hide' : 'Show'} state
        </button>
      </PrototypeSwitcher>
    </>
  );
}
