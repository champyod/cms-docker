'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

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

export function ScrollReset({ containerId = MAIN_SCROLL_CONTAINER_ID }: { containerId?: string }): null {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    resetScrollContainer(document, containerId);
  }, [pathname, containerId]);

  return null;
}
