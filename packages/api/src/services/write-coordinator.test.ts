import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { setup, teardown, type Harness } from '../test-support.js';
import {
  operationFingerprint,
  type CommandScope,
  type OperationIdentity,
} from './write-coordinator.js';

/**
 * Receipt lookup and claim at the coordinator's interface: no HTTP command
 * carries an operation ID yet (comments, filing and deletion adopt them in
 * later slices), so these drive the coordinator directly over a real database.
 */

/** A retry-safe command with nothing to write: record the intent, then complete. */
function complete<A>(scope: CommandScope, outcome: A): A {
  scope.intent({ guards: [] });
  return scope.complete(outcome);
}

const ID = '33333333-3333-4333-8333-333333333333';

function identity(fields: unknown[] = ['x']): OperationIdentity {
  return { id: ID, command: 'test.write', fingerprint: operationFingerprint('test.write', fields) };
}

function operationRow(h: Harness): unknown {
  return h.db.prepare(`SELECT state, outcome FROM operations WHERE operation_id = ?`).get(ID);
}

describe('WriteCoordinator receipts', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await request(h.app).post('/api/projects').send({ id: 'work', name: 'Work' });
  });
  afterEach(() => teardown(h));

  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

  it('a completed operation answers retries with its original acknowledgement without running again', async () => {
    const writes: string[] = [];
    const plan = (label: string) => ({
      operation: identity(),
      locate: () => ({ projects: ['inbox'] }),
      run: async (_l: unknown, scope: CommandScope) => {
        scope.intent({ guards: [] });
        writes.push(label);
        return scope.complete({ outcome: 'done', by: label });
      },
    });
    expect(await h.ctx.coordinator.command(plan('first'))).toEqual({
      outcome: 'done',
      by: 'first',
    });
    expect(await h.ctx.coordinator.command(plan('retry'))).toEqual({
      outcome: 'done',
      by: 'first',
    });
    expect(writes).toEqual(['first']);
  });

  it('an operation ID reused with different input is OPERATION_ID_CONFLICT', async () => {
    await h.ctx.coordinator.command({
      operation: identity(['x']),
      locate: () => ({ projects: ['inbox'] }),
      run: async (_l, scope) => complete(scope, { outcome: 'done' }),
    });
    await expect(
      h.ctx.coordinator.command({
        operation: identity(['y']),
        locate: () => ({ projects: ['inbox'] }),
        run: async (_l, scope) => complete(scope, { outcome: 'other' }),
      }),
    ).rejects.toMatchObject({ status: 409, code: 'OPERATION_ID_CONFLICT' });
  });

  it('a duplicate intent insert for the same operation ID resolves by re-lookup, not a second write', async () => {
    // Same key, different projects: both pass the locked receipt lookup
    // before either records its intent.
    const writes: string[] = [];
    const gates: Record<string, () => void> = {};
    const start = (label: string, project: string) =>
      h.ctx.coordinator.command({
        operation: identity(),
        locate: () => ({ projects: [project] }),
        run: async (_l, scope) => {
          await new Promise<void>((r) => (gates[label] = r));
          scope.intent({ guards: [{ project_id: project, scope: 'task', key: 'task-1' }] });
          writes.push(label);
          return scope.complete({ outcome: 'done', by: label });
        },
      });
    const a = start('a', 'inbox');
    const b = start('b', 'work');
    await settle();
    gates.a!();
    expect(await a).toEqual({ outcome: 'done', by: 'a' });
    gates.b!();
    expect(await b).toEqual({ outcome: 'done', by: 'a' });
    expect(writes).toEqual(['a']);
    expect(operationRow(h)).toEqual({
      state: 'completed',
      outcome: JSON.stringify({ outcome: 'done', by: 'a' }),
    });
  });

  it('an intent installs guards and a payload until completion releases them', async () => {
    let finish!: () => void;
    const running = h.ctx.coordinator.command({
      operation: identity(),
      locate: () => ({ projects: ['inbox'] }),
      run: async (_l, scope) => {
        scope.intent({
          guards: [{ project_id: 'inbox', scope: 'task', key: 'task-1' }],
          payload: 'exact bytes',
        });
        await new Promise<void>((r) => (finish = r));
        return scope.complete({ outcome: 'done' });
      },
    });
    await settle();
    expect(h.db.prepare(`SELECT payload FROM operation_payloads`).all()).toEqual([
      { payload: 'exact bytes' },
    ]);
    expect(h.db.prepare(`SELECT key FROM operation_guards`).all()).toEqual([{ key: 'task-1' }]);
    await expect(
      h.ctx.coordinator.command({
        operation: identity(),
        locate: () => ({ projects: ['work'] }),
        run: async (_l, scope) => complete(scope, { outcome: 'never' }),
      }),
    ).rejects.toMatchObject({ code: 'OPERATION_IN_PROGRESS' });

    finish();
    await running;
    expect(h.db.prepare(`SELECT * FROM operation_payloads`).all()).toEqual([]);
    expect(h.db.prepare(`SELECT * FROM operation_guards`).all()).toEqual([]);
  });

  it('an unfinished operation left pending by a failure goes to recovery', async () => {
    await expect(
      h.ctx.coordinator.command({
        operation: identity(),
        locate: () => ({ projects: ['inbox'] }),
        run: async (_l, scope) => {
          scope.intent({ guards: [{ project_id: 'inbox', scope: 'task', key: 'task-1' }] });
          throw new Error('disk gone');
        },
      }),
    ).rejects.toThrow('disk gone');
    await expect(
      h.ctx.coordinator.command({
        operation: identity(),
        locate: () => ({ projects: ['inbox'] }),
        run: async (_l, scope) => complete(scope, { outcome: 'retried' }),
      }),
    ).rejects.toMatchObject({
      code: 'RECOVERY_REQUIRED',
      details: { operationId: ID, inspect: `/api/recovery/${ID}` },
    });
    expect(operationRow(h)).toEqual({ state: 'pending', outcome: null });
  });
});
