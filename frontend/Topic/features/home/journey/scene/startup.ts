const STARTUP_BUDGET_MS = 6;
const ROW_CHECK_INTERVAL = 8;

export function throwIfStartupAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Scene startup was aborted', 'AbortError');
}

/** Stop waiting for GPU work on cancellation so owned resources can be released immediately. */
export function waitForStartup<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason ?? new DOMException('Scene startup was aborted', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    // Observe late settlement even after abort to avoid an unhandled rejection.
    pending.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}

/** Give painting and input a task boundary; a microtask alone would keep blocking both. */
export function yieldStartup(signal?: AbortSignal): Promise<void> {
  throwIfStartupAborted(signal);
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield(): Promise<void> } }).scheduler;
  // Use a browser task boundary without nested setTimeout's minimum delay.
  // Browsers without the Scheduling API retain the cancellable timer fallback.
  if (scheduler?.yield) return waitForStartup(scheduler.yield(), signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason ?? new DOMException('Scene startup was aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, 0);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Preserve row order while limiting uninterrupted procedural texture work. */
export async function forEachStartupRow(
  rows: number,
  renderRow: (row: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  throwIfStartupAborted(signal);
  let deadline = performance.now() + STARTUP_BUDGET_MS;
  for (let row = 0; row < rows; row++) {
    renderRow(row);
    if ((row + 1) % ROW_CHECK_INTERVAL === 0) {
      throwIfStartupAborted(signal);
      if (performance.now() >= deadline) {
        await yieldStartup(signal);
        deadline = performance.now() + STARTUP_BUDGET_MS;
      }
    }
  }
  // Several short passes must not accumulate into one uninterrupted task either.
  await yieldStartup(signal);
}
