import { describe, expect, it, vi } from 'vitest';
import { MAIN_SCROLL_CONTAINER_ID, resetScrollContainer } from '@/components/layout/ScrollReset';

describe('resetScrollContainer', () => {
  it('scrolls the container to top and reports success', () => {
    const scrollTo = vi.fn();
    const doc = { getElementById: (id: string) => (id === MAIN_SCROLL_CONTAINER_ID ? { scrollTo } : null) };

    expect(resetScrollContainer(doc, MAIN_SCROLL_CONTAINER_ID)).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
  });

  it('reports failure when the container is missing', () => {
    const doc = { getElementById: (_id: string) => null };

    expect(resetScrollContainer(doc, MAIN_SCROLL_CONTAINER_ID)).toBe(false);
  });
});
