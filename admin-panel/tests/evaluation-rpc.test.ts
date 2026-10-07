import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:net', () => ({ createConnection: vi.fn() }));

import { createConnection } from 'node:net';
import { EVALUATION_RPC_TIMEOUT_MS, invalidateViaRpc } from '@/lib/evaluation-rpc';

interface FakeSocket extends EventEmitter {
  setEncoding: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

function makeSocket(): FakeSocket {
  const socket = new EventEmitter() as FakeSocket;
  socket.setEncoding = vi.fn();
  socket.write = vi.fn();
  socket.destroy = vi.fn();
  return socket;
}

function socketForCall(): FakeSocket {
  return vi.mocked(createConnection).mock.results[0].value as unknown as FakeSocket;
}

const ORIGINAL_SECRET = process.env.RPC_SECRET;

afterEach(() => {
  vi.mocked(createConnection).mockReset();
  vi.useRealTimers();
  if (ORIGINAL_SECRET === undefined) delete process.env.RPC_SECRET;
  else process.env.RPC_SECRET = ORIGINAL_SECRET;
});

describe('invalidateViaRpc', () => {
  it('sends the authenticated CMS RPC frame and reports accepted when __error is null', async () => {
    process.env.RPC_SECRET = 'test-secret';
    vi.mocked(createConnection).mockImplementation(() => makeSocket() as never);
    const pending = invalidateViaRpc(7, 3, 'evaluation');
    const socket = socketForCall();
    socket.emit('connect');
    expect(socket.write).toHaveBeenCalledWith(
      `${JSON.stringify({
        __id: 1,
        __method: 'invalidate_submission',
        __data: { level: 'evaluation', submission_id: 7, dataset_id: 3 },
        __secret: 'test-secret',
      })}\r\n`,
    );
    socket.emit('data', '{"__id":1,"__data":null,"__error":null}\r\n');
    await expect(pending).resolves.toEqual({ accepted: true, timedOut: false });
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('reports not accepted when the service returns an RPC error (e.g. auth failure)', async () => {
    process.env.RPC_SECRET = 'test-secret';
    vi.mocked(createConnection).mockImplementation(() => makeSocket() as never);
    const pending = invalidateViaRpc(7, 3, 'evaluation');
    socketForCall().emit('data', '{"__id":1,"__data":null,"__error":"RPC authentication failed."}\r\n');
    await expect(pending).resolves.toEqual({ accepted: false, timedOut: false });
  });

  it('fails without connecting when RPC_SECRET is not configured', async () => {
    delete process.env.RPC_SECRET;
    vi.mocked(createConnection).mockImplementation(() => makeSocket() as never);
    await expect(invalidateViaRpc(7, 3, 'evaluation')).resolves.toEqual({ accepted: false, timedOut: false });
    expect(createConnection).not.toHaveBeenCalled();
  });

  it('reports neither accepted nor timed out on a transport error', async () => {
    process.env.RPC_SECRET = 'test-secret';
    vi.mocked(createConnection).mockImplementation(() => makeSocket() as never);
    const pending = invalidateViaRpc(7, 3, 'evaluation');
    socketForCall().emit('error', new Error('ECONNREFUSED'));
    await expect(pending).resolves.toEqual({ accepted: false, timedOut: false });
  });

  it('reports neither accepted nor timed out when the socket closes without a response', async () => {
    process.env.RPC_SECRET = 'test-secret';
    vi.mocked(createConnection).mockImplementation(() => makeSocket() as never);
    const pending = invalidateViaRpc(7, 3, 'evaluation');
    socketForCall().emit('close');
    await expect(pending).resolves.toEqual({ accepted: false, timedOut: false });
  });

  it('destroys a hanging connection and reports a timeout', async () => {
    vi.useFakeTimers();
    process.env.RPC_SECRET = 'test-secret';
    vi.mocked(createConnection).mockImplementation(() => makeSocket() as never);
    const pending = invalidateViaRpc(7, 3, 'evaluation');
    const socket = socketForCall();
    await vi.advanceTimersByTimeAsync(EVALUATION_RPC_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ accepted: false, timedOut: true });
    expect(socket.destroy).toHaveBeenCalled();
  });
});
