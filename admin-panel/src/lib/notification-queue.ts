import type { NotificationEvent } from '@/lib/notification-events';

export interface QueuedNotification extends NotificationEvent {
  id: string;
  timestamp: string;
}

// Why bounded: a reconnect replays this backlog, so an unbounded list would
// resend ancient history to every tab that regains focus.
export const MAX_QUEUE = 20;

const backlog: QueuedNotification[] = [];
const listeners = new Set<(frame: QueuedNotification) => void>();

/** True when the frame id has not been delivered to this viewer yet. */
export function isNewFrame(seen: ReadonlySet<string>, id: string): boolean {
  return !seen.has(id);
}

/** Advances a `?since=` cursor past stable `audit-<n>` frame ids only. */
export function cursorFromFrameId(lastId: number, frameId: string): number {
  const match = /^audit-(\d+)$/.exec(frameId);
  if (match === null) return lastId;
  const rowId = Number(match[1]);
  if (!Number.isFinite(rowId)) return lastId;
  return Math.max(lastId, rowId);
}

/** Fans one frame out to live subscribers and the reconnect backlog. */
export function publishNotification(frame: QueuedNotification): void {
  try {
    backlog.push(frame);
    while (backlog.length > MAX_QUEUE) backlog.shift();
    for (const listener of Array.from(listeners)) listener(frame);
  } catch {
    return;
  }
}

/** Registers a live listener; the returned function unsubscribes it. */
export function subscribe(listener: (frame: QueuedNotification) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Snapshot of the newest frames for a freshly connected viewer. */
export function getRecent(): QueuedNotification[] {
  return backlog.slice();
}
