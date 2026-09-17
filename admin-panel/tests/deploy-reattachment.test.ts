import { describe, expect, it, vi } from 'vitest';
import { createDeployReattachment } from '@/lib/deploy-reattachment';

const operation = { operationId: 'op-1', contestId: 12 };

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => { throw new Error('Promise not initialized'); };
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('app-wide deploy reattachment', () => {
  it('looks up once and attaches once across effect cleanup/re-setup', async () => {
    const pending = deferred<typeof operation | null>();
    const load = vi.fn(() => pending.promise);
    const resume = vi.fn();
    const recovery = createDeployReattachment(load);
    const cleanup = recovery.attach(resume);
    cleanup();
    recovery.attach(resume);
    pending.resolve(operation);
    await flush();
    recovery.attach(resume);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledExactlyOnceWith('op-1', 12);
  });

  it('does not attach when nothing is in flight', async () => {
    const resume = vi.fn();
    createDeployReattachment(async () => null).attach(resume);
    await flush();
    expect(resume).not.toHaveBeenCalled();
  });

  it('ignores late lookup results after provider unmount', async () => {
    const pending = deferred<typeof operation>();
    const resume = vi.fn();
    const cleanup = createDeployReattachment(() => pending.promise).attach(resume);
    cleanup();
    pending.resolve(operation);
    await flush();
    expect(resume).not.toHaveBeenCalled();
  });

  it('cannot override a manual deploy, resume, cancel or reset', async () => {
    const pending = deferred<typeof operation>();
    const resume = vi.fn();
    const recovery = createDeployReattachment(() => pending.promise);
    recovery.attach(resume);
    recovery.invalidate();
    pending.resolve(operation);
    await flush();
    recovery.attach(resume);
    await flush();
    expect(resume).not.toHaveBeenCalled();
  });

  it('keeps discovery failures non-fatal and does not retry per surface', async () => {
    const load = vi.fn(async () => { throw new Error('Forbidden'); });
    const resume = vi.fn();
    const recovery = createDeployReattachment(load);
    recovery.attach(resume);
    await flush();
    recovery.attach(resume);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
  });
});
