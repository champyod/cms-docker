// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { Header } from '@/components/layout/Header';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import en from '@/dictionaries/en.json';

// Why these stubs: the header pulls the notification poll and the palette's entity
// searchers, and those modules reach Prisma at import time. The palette only needs
// the router and the dictionary, so every data source is answered here instead.
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/en/contests',
}));
vi.mock('@/app/actions/questions', () => ({
  getUnansweredQuestions: vi.fn(() => Promise.resolve([])),
}));
vi.mock('@/app/actions/contests', () => ({
  getContests: vi.fn(() => Promise.resolve({ contests: [] })),
  getAvailableContests: vi.fn(() => Promise.resolve({ success: true, contests: [] })),
  activateContest: vi.fn(() => Promise.resolve({ success: true })),
}));
vi.mock('@/app/actions/tasks', () => ({
  getTasks: vi.fn(() => Promise.resolve({ tasks: [] })),
}));
vi.mock('@/app/actions/teams', () => ({
  getTeams: vi.fn(() => Promise.resolve({ success: true, data: [] })),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderHeader(): void {
  render(
    <DictionaryProvider dict={en}>
      <Header permissionKeys={[]} />
    </DictionaryProvider>,
  );
}

function searchButton(): HTMLElement {
  return screen.getByRole('button', { name: /search navigation, entities, and actions/i });
}

function palette(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: /command palette/i });
}

// Why the drain: Radix restores focus from a queued task, and the palette focuses its
// input from another one, so a single settled turn is not enough to see a late reopen.
async function drainPendingTasks(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  });
}

describe('Header search palette focus', () => {
  it('opens the palette from the search button', async () => {
    renderHeader();
    // Why the explicit focus: a real click leaves the button as the active element, and
    // the dialog captures that element to hand focus back to on dismissal.
    searchButton().focus();
    fireEvent.click(searchButton());

    expect(await screen.findByRole('dialog', { name: /command palette/i })).not.toBeNull();
  });

  it('stays closed when escape returns focus to the search button', async () => {
    renderHeader();
    searchButton().focus();
    fireEvent.click(searchButton());
    const opened = await screen.findByRole('dialog', { name: /command palette/i });

    fireEvent.keyDown(opened, { key: 'Escape' });
    await drainPendingTasks();

    // Why the focus assertion alongside: focus returning to the invoker is the moment the
    // reopen used to fire, so it has to hold here for the check above to mean anything.
    expect(palette()).toBeNull();
    expect(document.activeElement).toBe(searchButton());
  });
});
