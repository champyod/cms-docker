import { describe, expect, it } from 'vitest';
import { cursorFromFrameId, isNewFrame } from '@/lib/notification-queue';

describe('bell duplicate guard', () => {
  it('delivers a reconnected frame id exactly once', () => {
    const seen = new Set<string>();
    let toasts = 0;
    let unread = 0;
    for (const id of ['audit-9', 'audit-9']) {
      if (!isNewFrame(seen, id)) continue;
      seen.add(id);
      toasts += 1;
      unread += 1;
    }
    expect(toasts).toBe(1);
    expect(unread).toBe(1);
  });

  it('advances the since cursor only on newer audit frames', () => {
    expect(cursorFromFrameId(5, 'audit-9')).toBe(9);
    expect(cursorFromFrameId(9, 'audit-5')).toBe(9);
    expect(cursorFromFrameId(9, 'enrol-burst-123')).toBe(9);
  });
});
