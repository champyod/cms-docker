'use client';

import { useAppRouter } from '@/hooks/useAppRouter';
import { useLiveCursor } from '@/lib/live/use-live-cursor';

/**
 * Re-renders the page it sits on whenever that surface's change cursor moves.
 *
 * Why a leaf component and not a subscription in the page: these surfaces are server components, so
 * this is the smallest client piece that can ask the router to render one again.
 *
 * Why it renders nothing: the push channel is how the surface stays current, not something the
 * reader has to watch. A connection that drops is retried by the stream itself, so a status badge
 * here would report a state the reader can neither act on nor trust — the data on screen is what
 * says whether the read succeeded.
 */
export function LiveRefresh({ url }: { url: string }): null {
  const router = useAppRouter();
  useLiveCursor(url, () => router.refresh());
  return null;
}
