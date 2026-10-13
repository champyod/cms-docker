'use client';

import { LiveIndicator } from '@/components/core/LiveIndicator';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useLiveCursor } from '@/lib/live/use-live-cursor';

/**
 * Re-renders the page it sits on whenever that surface's change cursor moves, and shows the
 * connection's state beside it.
 *
 * Why a leaf component and not a subscription in the page: these surfaces are server components, so
 * this is the smallest client piece that can ask the router to render one again.
 */
export function LiveRefresh({ url }: { url: string }): React.JSX.Element {
  const router = useAppRouter();
  const status = useLiveCursor(url, () => router.refresh());
  return <LiveIndicator status={status} />;
}
