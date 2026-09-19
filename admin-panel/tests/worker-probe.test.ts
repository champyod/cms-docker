import net from 'net';
import { describe, expect, it } from 'vitest';
import { probeReachable } from '@/lib/worker-stats';

describe('probeReachable', () => {
  it('rejects empty hosts and invalid ports without dialing', async () => {
    await expect(probeReachable('', 26004, 200)).resolves.toBe(false);
    await expect(probeReachable('127.0.0.1', 0, 200)).resolves.toBe(false);
    await expect(probeReachable('127.0.0.1', -1, 200)).resolves.toBe(false);
  });

  it('reports false for a closed local port', async () => {
    await expect(probeReachable('127.0.0.1', 54321, 500)).resolves.toBe(false);
  });

  it('reports true for a listening local port', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    await expect(probeReachable('127.0.0.1', port, 1000)).resolves.toBe(true);
    server.close();
  });
});
