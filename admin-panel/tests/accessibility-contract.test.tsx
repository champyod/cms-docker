// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { Tabs, type TabItem } from '@/components/core/Tabs';
import { MobileBottomBar } from '@/components/layout/MobileBottomBar';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import en from '@/dictionaries/en.json';

vi.mock('next/navigation', () => ({ usePathname: () => '/en/contests' }));

afterEach(() => cleanup());

const TOUCH_TARGET_PATTERN = /(?:^|\s)(?:min-)?(?:h|w)-11(?:\s|$)/;

const TAB_ITEMS: readonly TabItem[] = [
  { id: 'overview', label: 'Overview', href: '/en/contests/5' },
  { id: 'participants', label: 'Participants', href: '/en/contests/5/participants' },
  { id: 'tasks', label: 'Tasks' },
];

function controlClassNames(markup: string): string[] {
  return Array.from(markup.matchAll(/<(?:a|button)[^>]*\sclass="([^"]*)"/g)).map((match) => match[1]);
}

function isTouchSized(className: string): boolean {
  return TOUCH_TARGET_PATTERN.test(className);
}

function renderBottomBar(permissionKeys: readonly string[]): string {
  return renderToStaticMarkup(
    <DictionaryProvider dict={en}>
      <MobileBottomBar locale="en" permissionKeys={permissionKeys} open={false} onToggle={() => undefined} />
    </DictionaryProvider>,
  );
}

describe('Tabs', () => {
  it('gives every tab a 44px touch target', () => {
    const markup = renderToStaticMarkup(
      <Tabs items={TAB_ITEMS} activeId="overview" ariaLabel="Contest sections" onSelect={() => undefined} />,
    );
    const classNames = controlClassNames(markup);
    expect(classNames).toHaveLength(TAB_ITEMS.length);
    expect(classNames.every(isTouchSized)).toBe(true);
  });

  it('lets a wide tab strip scroll instead of wrapping or clipping', () => {
    const markup = renderToStaticMarkup(
      <Tabs items={TAB_ITEMS} activeId="overview" ariaLabel="Contest sections" onSelect={() => undefined} />,
    );
    expect(markup).toContain('overflow-x-auto');
  });

  it('marks only the active tab as the current page', () => {
    const markup = renderToStaticMarkup(
      <Tabs items={TAB_ITEMS} activeId="participants" ariaLabel="Contest sections" onSelect={() => undefined} />,
    );
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('keeps the strip a labelled landmark so a reader can skip past it', () => {
    render(<Tabs items={TAB_ITEMS} activeId="overview" ariaLabel="Contest sections" onSelect={() => undefined} />);
    expect(screen.getByRole('navigation', { name: 'Contest sections' })).toBeTruthy();
  });
});

describe('MobileBottomBar touch targets', () => {
  it('gives every slot and the More control a 44px touch target', () => {
    const classNames = controlClassNames(renderBottomBar(['contest:read', 'task:read', 'user:read']));
    expect(classNames.length).toBeGreaterThan(0);
    expect(classNames.every(isTouchSized)).toBe(true);
  });

  it('keeps the home-indicator inset so the bar is not covered on iOS', () => {
    expect(renderBottomBar(['contest:read'])).toContain('pb-[env(safe-area-inset-bottom)]');
  });
});

describe('Button reduced motion', () => {
  const source = readFileSync('src/components/core/Button.tsx', 'utf8');

  it('reads the reader motion preference through the motion library', () => {
    // Why a source read: `whileHover` and `whileTap` only reach the DOM while a
    // pointer is down, so a rendered assertion would prove nothing about which
    // variant of them was passed.
    expect(source).toContain('useReducedMotion');
  });

  it('omits the hover and tap scale when the reader asked for less motion', () => {
    const motionGate = source.slice(source.indexOf('useReducedMotion'));
    expect(motionGate).toMatch(/whileHover=\{[^}]*shouldReduceMotion\s*\?\s*undefined\s*:/);
    expect(motionGate).toMatch(/whileTap=\{[^}]*shouldReduceMotion\s*\?\s*undefined\s*:/);
  });
});

describe('global reduced motion stylesheet', () => {
  const stylesheet = readFileSync('src/app/globals.css', 'utf8');

  it('cancels animation and transition for every element when motion is reduced', () => {
    // Why a source read: the rule is plain CSS with no runtime hook, so a test
    // that renders components can never observe it.
    expect(stylesheet).toContain('prefers-reduced-motion: reduce');
    const block = stylesheet.slice(stylesheet.indexOf('prefers-reduced-motion: reduce'));
    expect(block).toMatch(/animation-duration:\s*0\.01ms/);
    expect(block).toMatch(/transition-duration:\s*0\.01ms/);
  });
});
