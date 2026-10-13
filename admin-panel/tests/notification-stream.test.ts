import { describe, expect, it, vi } from 'vitest';

import { LIVE_HEARTBEAT_MS } from '@/lib/constants/live-stream';

vi.mock('@/lib/api-utils', () => ({
  verifyApiPermission: async () => ({ authorized: true }),
}));
vi.mock('@/lib/notification-queue', () => ({
  getRecent: () => [
    { id: 'audit-5', level: 'critical', title: 't', detail: 'd', timestamp: new Date(0).toISOString() },
    { id: 'audit-9', level: 'critical', title: 't', detail: 'd', timestamp: new Date(0).toISOString() },
  ],
  subscribe: () => () => undefined,
}));

describe('notification stream', () => {
  it('replays only backlog newer than since', async () => {
    const { GET } = await import('@/app/api/notifications/stream/route');
    const response = await GET(new Request('http://panel.local/api/notifications/stream?since=5'));
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    expect(text).toContain('audit-9');
    expect(text).not.toContain('audit-5');
    await reader.cancel();
  });

  it('sends the full backlog without since', async () => {
    const { GET } = await import('@/app/api/notifications/stream/route');
    const response = await GET(new Request('http://panel.local/api/notifications/stream'));
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    expect(text).toContain('audit-5');
    await reader.cancel();
  });

  it('holds an idle stream open with a real frame, not a comment', async () => {
    vi.useFakeTimers();
    try {
      const { GET } = await import('@/app/api/notifications/stream/route');
      // since=9 excludes both mocked frames, so the stream starts quiet — the state a proxy used to cut.
      const response = await GET(new Request('http://panel.local/api/notifications/stream?since=9'));
      expect(response.headers.get('X-Accel-Buffering')).toBe('no');
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();

      vi.advanceTimersByTime(LIVE_HEARTBEAT_MS);
      const beat = await reader.read();
      const text = new TextDecoder().decode(beat.value);
      // A comment would never dispatch the client's onmessage, so it could not hold the watchdog.
      expect(text).toBe('data: {}\n\n');
      await reader.cancel();
    } finally {
      vi.useRealTimers();
    }
  });
});
