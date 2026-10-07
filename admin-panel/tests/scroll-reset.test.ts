// @vitest-environment happy-dom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import {
  MAIN_SCROLL_CONTAINER_ID,
  ScrollReset,
  resetScrollContainer,
  shouldResetMainScroll,
} from '@/components/layout/ScrollReset';

let currentPathname = '/en/contests';
const scrollCalls: Array<{ top: number; behavior: ScrollBehavior }> = [];

vi.mock('next/navigation', () => ({ usePathname: () => currentPathname }));

afterEach(() => {
  cleanup();
  scrollCalls.length = 0;
  currentPathname = '/en/contests';
});

function installContainer(): void {
  const container = document.createElement('div');
  container.id = MAIN_SCROLL_CONTAINER_ID;
  container.scrollTo = ((options: { top: number; behavior: ScrollBehavior }) => {
    scrollCalls.push(options);
  }) as unknown as HTMLElement['scrollTo'];
  document.body.append(container);
}

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

describe('shouldResetMainScroll', () => {
  it('resets on the first render, where there is no previous path to compare', () => {
    expect(shouldResetMainScroll(null, '/en/contests/5')).toBe(true);
  });

  it('resets for a true page transition into a different record', () => {
    expect(shouldResetMainScroll('/en/contests/5', '/en/contests/6')).toBe(true);
  });

  it('resets for a module change', () => {
    expect(shouldResetMainScroll('/en/contests/5', '/en/tasks/9')).toBe(true);
  });

  it('holds the offset for a nested record tab', () => {
    expect(shouldResetMainScroll('/en/contests/5', '/en/contests/5/participants')).toBe(false);
  });

  it('holds the offset when a nested record tab closes back to the record', () => {
    expect(shouldResetMainScroll('/en/contests/5/participants', '/en/contests/5')).toBe(false);
  });

  it('does nothing when only the query changed, because the path is the same', () => {
    expect(shouldResetMainScroll('/en/contests/5', '/en/contests/5')).toBe(false);
  });
});

describe('ScrollReset', () => {
  it('leaves the container where it is when a record tab opens', () => {
    installContainer();
    currentPathname = '/en/contests/5';
    const view = render(createElement(ScrollReset));
    scrollCalls.length = 0;

    currentPathname = '/en/contests/5/participants';
    view.rerender(createElement(ScrollReset));

    expect(scrollCalls).toHaveLength(0);
  });

  it('returns the container to the top for a different record', () => {
    installContainer();
    currentPathname = '/en/contests/5';
    const view = render(createElement(ScrollReset));
    scrollCalls.length = 0;

    currentPathname = '/en/contests/6';
    view.rerender(createElement(ScrollReset));

    expect(scrollCalls).toEqual([{ top: 0, behavior: 'instant' }]);
  });
});
