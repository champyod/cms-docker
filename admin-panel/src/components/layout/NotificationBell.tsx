'use client';

import { useCallback, useRef, useState } from 'react';
import { BellRing } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/core/Button';
import { useLiveStream } from '@/hooks/useLiveStream';
import { cursorFromFrameId, isNewFrame } from '@/lib/notification-queue';

interface AlertFrame {
  id: string;
  level: 'critical' | 'warning';
  title: string;
  detail: string;
  timestamp: string;
}

const MAX_EVENTS = 20;

/** System alert bell: critical admin actions and unusual-activity warnings via server push. */
export function NotificationBell(): React.JSX.Element {
  const [events, setEvents] = useState<AlertFrame[]>([]);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [lastId, setLastId] = useState(0);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const handleFrame = useCallback((frame: AlertFrame) => {
    if (!frame || typeof frame.id !== 'string') return;
    // Why the guard sits before every side effect: a reconnect replays the
    // backlog, and the list dedup below used to swallow the repeat while the
    // toast and unread count still fired a second time.
    if (!isNewFrame(seenIdsRef.current, frame.id)) return;
    seenIdsRef.current.add(frame.id);
    setLastId((previous) => cursorFromFrameId(previous, frame.id));
    setEvents((prev) => [frame, ...prev].slice(0, MAX_EVENTS));
    setUnread((count) => count + 1);
    if (frame.level === 'critical') toast.error(frame.title, { description: frame.detail });
    else toast.warning(frame.title, { description: frame.detail });
  }, []);

  // Why the cursor travels in the url: the stream replays its backlog on every
  // (re)connect, and `since` narrows that replay to frames this viewer is
  // still missing — which is what stops focus toggles from re-toasting.
  useLiveStream<AlertFrame>({ url: `/api/notifications/stream?since=${lastId}`, onFrame: handleFrame });

  const toggle = (): void => {
    setOpen((v) => !v);
    setUnread(0);
  };

  return (
    <div className="relative">
      <Button variant="ghost" size="sm" iconOnly tooltip="System alerts" onClick={toggle}>
        <span className="relative flex">
          <BellRing className="size-4" />
          {unread > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-0.5 rounded-full bg-destructive text-[10px] font-bold text-white flex items-center justify-center animate-pulse">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </span>
      </Button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-xl border border-border bg-card shadow-xl z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">System alerts</span>
            <button type="button" onClick={() => setEvents([])} className="text-xs text-muted-foreground hover:text-foreground">
              Clear
            </button>
          </div>
          {events.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">No alerts yet.</p>
          ) : (
            events.map((event) => (
              <div key={event.id} className="px-3 py-2 border-b border-border/50 last:border-0">
                <p className="text-xs font-semibold text-foreground">{event.title}</p>
                <p className="text-xs text-muted-foreground break-words">{event.detail}</p>
                <p className="text-[10px] text-muted-foreground/70 font-mono">{new Date(event.timestamp).toLocaleString()}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
