import { checkAbort, abortError } from '../../utils/async/cancellation.js';

/**
 * Isolate cancellation by page document. epoch increases per controller; stale requests cannot revive cancelled runs.
 * Record cancellations that arrive first too; remove closed tabs and retain at most 100 documents to bound memory.
 */
export function createPageRuns() {
  const runs = new Map();
  function entry(sender, epoch) {
    if (!sender.tab || sender.frameId !== 0)
      throw new Error('Only the main document of the current page is supported.');
    if (!Number.isSafeInteger(epoch) || epoch < 0) throw new Error('Invalid translation run.');
    const key = sender.documentId || `${sender.tab.id}:${sender.frameId}`;
    let run = runs.get(key);
    if (run && epoch < run.epoch) throw abortError();
    if (!run || epoch > run.epoch) {
      run?.controller.abort();
      run = { epoch, tabId: sender.tab.id, controller: new AbortController() };
      runs.delete(key);
      runs.set(key, run);
      while (runs.size > 100) {
        const oldest = runs.keys().next().value;
        runs.get(oldest).controller.abort();
        runs.delete(oldest);
      }
    }
    return run;
  }
  return {
    signal(sender, epoch) {
      const signal = entry(sender, epoch).controller.signal;
      checkAbort(signal);
      return signal;
    },
    cancel(sender, epoch) {
      try {
        entry(sender, epoch).controller.abort();
      } catch (error) {
        if (error.name !== 'AbortError') throw error;
      }
    },
    removeTab(tabId) {
      for (const [key, run] of runs)
        if (run.tabId === tabId) {
          run.controller.abort();
          runs.delete(key);
        }
    },
    cancelAll() {
      // Retain epoch tombstones so late requests from the same run cannot restart after settings change.
      for (const run of runs.values()) run.controller.abort();
    },
  };
}
