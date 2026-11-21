import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeployReattachment } from '@/lib/deploy-reattachment';

const operation = { operationId: 'op-1', contestId: 12 };
const INTERVAL_MS = 1000;

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => { throw new Error('Promise not initialized'); };
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('app-wide deploy reattachment', () => {
  it('hands one operation over once across effect cleanup/re-setup', async () => {
    const pending = deferred<typeof operation | null>();
    const load = vi.fn(() => pending.promise);
    const resume = vi.fn();
    const recovery = createDeployReattachment(load, INTERVAL_MS);
    const cleanup = recovery.attach(resume);
    cleanup();
    recovery.attach(resume);
    pending.resolve(operation);
    await flush();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(resume).toHaveBeenCalledExactlyOnceWith('op-1', 12);
  });

  it('discovers an operation that appears after the mount, without handing it back twice', async () => {
    let current: typeof operation | null = null;
    const load = vi.fn(async () => current);
    const resume = vi.fn();
    const recovery = createDeployReattachment(load, INTERVAL_MS);
    const cleanup = recovery.attach(resume);
    await flush();
    expect(resume).not.toHaveBeenCalled();

    // Why the lookup repeats: an operation can appear while this panel is already open — another
    // tab's deploy, or one whose watch this panel released and the server is settling right now.
    current = operation;
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(resume).toHaveBeenCalledExactlyOnceWith('op-1', 12);

    // The panel owns that operation from here: a second hand-over would fight the state it drives.
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(resume).toHaveBeenCalledTimes(1);

    // A different operation is still picked up.
    current = { operationId: 'op-2', contestId: 13 };
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(resume).toHaveBeenLastCalledWith('op-2', 13);
    cleanup();
  });

  it('does not attach when nothing is in flight', async () => {
    const resume = vi.fn();
    const cleanup = createDeployReattachment(async () => null, INTERVAL_MS).attach(resume);
    await flush();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);
    expect(resume).not.toHaveBeenCalled();
    cleanup();
  });

  it('ignores late lookup results after provider unmount', async () => {
    const pending = deferred<typeof operation>();
    const resume = vi.fn();
    const cleanup = createDeployReattachment(() => pending.promise, INTERVAL_MS).attach(resume);
    cleanup();
    pending.resolve(operation);
    await flush();
    expect(resume).not.toHaveBeenCalled();
  });

  it('cannot override a manual deploy, resume, cancel or reset', async () => {
    const pending = deferred<typeof operation>();
    const resume = vi.fn();
    const recovery = createDeployReattachment(() => pending.promise, INTERVAL_MS);
    recovery.attach(resume);
    recovery.invalidate();
    pending.resolve(operation);
    await flush();
    expect(resume).not.toHaveBeenCalled();
  });

  it('does not resurface an operation the panel dismissed', async () => {
    const load = vi.fn(async () => operation);
    const resume = vi.fn();
    const recovery = createDeployReattachment(load, INTERVAL_MS);
    const cleanup = recovery.attach(resume);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(resume).toHaveBeenCalledTimes(1);

    // Dismissing is about this panel, not about the deploy: the operation keeps running, and the
    // discovery that follows must not bring it back to a surface the operator just closed.
    recovery.invalidate(operation.operationId);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(load.mock.calls.length).toBeGreaterThan(2);
    cleanup();
  });

  it('keeps discovery failures non-fatal and keeps looking', async () => {
    const load = vi.fn(async (): Promise<typeof operation | null> => { throw new Error('Forbidden'); });
    const resume = vi.fn();
    const cleanup = createDeployReattachment(load, INTERVAL_MS).attach(resume);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);
    expect(resume).not.toHaveBeenCalled();
    expect(load.mock.calls.length).toBeGreaterThan(1);
    cleanup();
  });
});
