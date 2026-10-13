import assert from 'node:assert/strict';
import { forEachStartupRow, waitForStartup, yieldStartup } from './startup';

async function main() {
  const rows: number[] = [];
  let inputRan = false;
  setTimeout(() => { inputRan = true; }, 0);
  await forEachStartupRow(20, (row) => { rows.push(row); });
  assert.deepEqual(rows, Array.from({ length: 20 }, (_, row) => row));
  assert.ok(inputRan, 'Startup work must yield to another task, not only to microtasks');

  const originalNow = Object.getOwnPropertyDescriptor(performance, 'now');
  let elapsed = 0;
  let processed = 0;
  let processedAtInput = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => elapsed });
  try {
    setTimeout(() => { processedAtInput = processed; }, 0);
    await forEachStartupRow(100, () => { processed++; elapsed++; });
    assert.equal(processedAtInput, 8, 'An expired time budget must yield before processing all rows');
    assert.equal(processed, 100);
  } finally {
    if (originalNow) Object.defineProperty(performance, 'now', originalNow);
    else Reflect.deleteProperty(performance, 'now');
  }

  const beforeStart = new AbortController();
  beforeStart.abort();
  await assert.rejects(forEachStartupRow(1, () => assert.fail('Aborted work ran'), beforeStart.signal), { name: 'AbortError' });

  const duringRows = new AbortController();
  const partial: number[] = [];
  await assert.rejects(forEachStartupRow(100, (row) => {
    partial.push(row);
    if (row === 9) duringRows.abort();
  }, duringRows.signal), { name: 'AbortError' });
  assert.deepEqual(partial, Array.from({ length: 16 }, (_, row) => row), 'Cancellation stops at the next row checkpoint');

  const waiting = new AbortController();
  const pending = yieldStartup(waiting.signal);
  waiting.abort();
  await assert.rejects(pending, { name: 'AbortError' });

  assert.equal(await waitForStartup(Promise.resolve(7)), 7);
  assert.equal(await waitForStartup(Promise.resolve(8), new AbortController().signal), 8);
  const failure = new Error('Compilation failed');
  await assert.rejects(waitForStartup(Promise.reject(failure), new AbortController().signal), (error) => error === failure);

  const compiling = new AbortController();
  let rejectCompilation!: (error: Error) => void;
  let released = false;
  const compilation = new Promise<never>((_resolve, reject) => { rejectCompilation = reject; });
  const preparing = (async () => {
    try {
      await waitForStartup(compilation, compiling.signal);
      assert.fail('Cancelled startup continued after compilation');
    } finally {
      released = true;
    }
  })();
  compiling.abort();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await assert.rejects(Promise.race([
      preparing,
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Cancellation waited for GPU completion')), 100); }),
    ]), { name: 'AbortError' });
  } finally {
    clearTimeout(deadline);
  }
  assert.ok(released, 'Cancellation releases owned resources while GPU compilation is still pending');
  rejectCompilation(failure);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await assert.rejects(waitForStartup(Promise.reject(failure), beforeStart.signal), { name: 'AbortError' });

  const originalScheduler = Object.getOwnPropertyDescriptor(globalThis, 'scheduler');
  let schedulingCalls = 0;
  Object.defineProperty(globalThis, 'scheduler', {
    configurable: true,
    value: { yield: () => {
      schedulingCalls++;
      return new Promise<void>((resolve) => setImmediate(resolve));
    } },
  });
  try {
    await yieldStartup();
    assert.equal(schedulingCalls, 1, 'Use the browser scheduler when available');
    const scheduled = new AbortController();
    const task = yieldStartup(scheduled.signal);
    scheduled.abort();
    await assert.rejects(task, { name: 'AbortError' });
  } finally {
    if (originalScheduler) Object.defineProperty(globalThis, 'scheduler', originalScheduler);
    else Reflect.deleteProperty(globalThis, 'scheduler');
  }
  console.log('Scene startup scheduling tests passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
