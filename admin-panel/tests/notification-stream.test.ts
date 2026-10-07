import { describe, expect, it, vi } from 'vitest';

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
});
