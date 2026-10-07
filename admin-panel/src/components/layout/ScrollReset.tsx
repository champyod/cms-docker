'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

import { isNestedRecordTabTransition } from '@/lib/list-state';

interface ScrollableElement {
  scrollTo(options: { top: number; behavior: ScrollBehavior }): void;
}

interface ScrollDocument {
  getElementById(id: string): ScrollableElement | null;
}

export const MAIN_SCROLL_CONTAINER_ID = 'main-scroll-container';

export function resetScrollContainer(doc: ScrollDocument, containerId: string): boolean {
  const container = doc.getElementById(containerId);
  if (!container) return false;
  container.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  return true;
}

/**
 * Whether a pathname change is a page the reader has to start at the top of.
 *
 * Why a record tab is exempt: the record header and the list above it are already
 * on screen, and snapping back to the top on every tab hides the tab strip the
 * reader just pressed.
 */
export function shouldResetMainScroll(previousPath: string | null, nextPath: string): boolean {
  if (previousPath === null) return true;
  if (previousPath === nextPath) return false;
  return !isNestedRecordTabTransition(previousPath, nextPath);
}

export function ScrollReset({ containerId = MAIN_SCROLL_CONTAINER_ID }: { containerId?: string }): null {
  const pathname = usePathname() ?? '';
  const previousPathRef = useRef<string | null>(null);

  // Layout effect (browser only): reset before paint so the next page never
  // flashes at the previous scroll offset.
  const usePositionReset = typeof window === 'undefined' ? useEffect : useLayoutEffect;
  usePositionReset(() => {
    const previousPath = previousPathRef.current;
    previousPathRef.current = pathname;
    if (typeof document === 'undefined') return;
    if (!shouldResetMainScroll(previousPath, pathname)) return;
    resetScrollContainer(document, containerId);
  }, [pathname, containerId]);

  return null;
}
