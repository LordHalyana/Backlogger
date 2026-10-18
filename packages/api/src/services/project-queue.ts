/**
 * One in-process operation queue per project. Every document mutation
 * (create/update/move/delete/archive) and project reindex runs through it, so
 * operations on the same project never interleave: each one loads current
 * state, checks its preconditions, persists and updates the index before the
 * next starts. Different projects run independently.
 *
 * Assumes a single server process owns the data dir; it does not coordinate
 * across processes or with external writers.
 */
export class ProjectQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(projectId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.catch(() => undefined);
    this.tails.set(projectId, tail);
    void tail.then(() => {
      if (this.tails.get(projectId) === tail) this.tails.delete(projectId);
    });
    return result;
  }
}
