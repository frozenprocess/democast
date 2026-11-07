// Resources: what a run must release when it ends, however it ends.

// A Resources collects cleanup functions as things are created, and runs
// them in reverse order (last created, first released). closeAll can be
// called early, to free the machine before a long render; the finally block
// calls it again and finds nothing left to do. One cleanup failing doesn't
// stop the rest.
export class Resources {
  #cleanups = [];

  // add registers a cleanup (it may return a promise) and returns what it
  // was given.
  add(cleanup) {
    this.#cleanups.push(cleanup);
    return cleanup;
  }

  async closeAll() {
    while (this.#cleanups.length) {
      try {
        await this.#cleanups.pop()();
      } catch {
        // Releasing is best effort: the run's own error matters more.
      }
    }
  }
}
