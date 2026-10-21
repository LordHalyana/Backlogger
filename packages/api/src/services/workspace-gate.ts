/**
 * The outermost lock of the write coordinator: shared for commands, Reload,
 * settings, folders and recovery actions; exclusive for a full Reindex and
 * the startup pass. Waiters are served in arrival order, so a queued
 * exclusive holder is not starved by a stream of shared ones (and shared
 * waiters behind it wait for it).
 *
 * Not re-entrant: code holding the gate must not ask for it again.
 */
export class WorkspaceGate {
  private shared = 0;
  private exclusive = false;
  private readonly waiters: Array<{ exclusive: boolean; grant: () => void }> = [];

  async withShared<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire(false);
    try {
      return await operation();
    } finally {
      this.shared -= 1;
      this.drain();
    }
  }

  async withExclusive<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire(true);
    try {
      return await operation();
    } finally {
      this.exclusive = false;
      this.drain();
    }
  }

  private acquire(exclusive: boolean): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push({ exclusive, grant: resolve });
      this.drain();
    });
  }

  private drain(): void {
    while (this.waiters.length > 0 && !this.exclusive) {
      const next = this.waiters[0]!;
      if (next.exclusive) {
        if (this.shared > 0) return;
        this.exclusive = true;
      } else {
        this.shared += 1;
      }
      this.waiters.shift();
      next.grant();
    }
  }
}
