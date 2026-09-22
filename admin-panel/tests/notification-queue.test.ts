import { describe, expect, it } from 'vitest';
import { getRecent, isNewFrame, publishNotification, subscribe } from '@/lib/notification-queue';

describe('notification queue', () => {
  it('delivers each published frame once per subscriber', () => {
    const seen: string[] = [];
    const off = subscribe((frame) => { seen.push(frame.id); });
    publishNotification({ id: 'audit-1', level: 'critical', title: 't', detail: 'd', timestamp: new Date(0).toISOString() });
    off();
    publishNotification({ id: 'audit-2', level: 'critical', title: 't', detail: 'd', timestamp: new Date(0).toISOString() });
    expect(seen).toEqual(['audit-1']);
  });

  it('rejects already-seen ids', () => {
    expect(isNewFrame(new Set(['audit-1']), 'audit-1')).toBe(false);
    expect(isNewFrame(new Set(['audit-1']), 'audit-2')).toBe(true);
  });

  it('exposes published frames as recent backlog', () => {
    publishNotification({ id: 'audit-3', level: 'critical', title: 't', detail: 'd', timestamp: new Date(0).toISOString() });
    expect(getRecent().some((frame) => frame.id === 'audit-3')).toBe(true);
  });
});
