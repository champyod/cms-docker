// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { Header } from '@/components/layout/Header';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import en from '@/dictionaries/en.json';

// Why: the palette must switch the active contest through the deploy path (DB write + config sync
// + stack recreate), not the bare activateContest that only flips contests.is_active.
const deploy = vi.hoisted(() => vi.fn(async () => {}));
const activateContest = vi.hoisted(() => vi.fn(async () => ({ success: true })));

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
  getAvailableContests: vi.fn(() => Promise.resolve({ success: true, contests: [{ id: 5, name: 'Spring', is_active: false }] })),
  activateContest,
}));
vi.mock('@/app/actions/tasks', () => ({
  getTasks: vi.fn(() => Promise.resolve({ tasks: [] })),
}));
vi.mock('@/app/actions/teams', () => ({
  getTeams: vi.fn(() => Promise.resolve({ success: true, data: [] })),
}));
// Why: the header reads the shared notification service, whose provider wraps the shell in the real
// app; this render supplies the header alone, so the service arrives stubbed and opens no stream.
vi.mock('@/lib/live/notifications', () => ({
  useLiveNotifications: () => ({
    events: [],
    unread: 0,
    unansweredCount: 0,
    clearEvents: vi.fn(),
    markSeen: vi.fn(),
  }),
}));
vi.mock('@/hooks/useDeployContest', () => ({
  useDeployContest: () => ({
    state: { phase: 'idle', contestId: null, operationId: null, status: null, error: null, warning: null, log: '', percent: null, startedAt: null },
    deploy,
    resume: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderHeader(permissionKeys: readonly string[]): void {
  render(
    <DictionaryProvider dict={en}>
      <Header permissionKeys={permissionKeys} />
    </DictionaryProvider>,
  );
}

function searchButton(): HTMLElement {
  return screen.getByRole('button', { name: /search navigation, entities, and actions/i });
}

async function openPalette(): Promise<void> {
  fireEvent.click(searchButton());
  await screen.findByRole('dialog', { name: /command palette/i });
}

describe('palette contest switch', () => {
  it('deploys the selected contest instead of flipping the flag', async () => {
    renderHeader(['contest:list', 'deployment:deploy']);
    await openPalette();

    fireEvent.click(await screen.findByText('Switch to Spring'));

    await waitFor(() => expect(deploy).toHaveBeenCalledWith(5));
    expect(activateContest).not.toHaveBeenCalled();
  });

  it('hides the switch rows for a reader without deployment:deploy', async () => {
    renderHeader(['contest:list']);
    await openPalette();
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByText('Switch to Spring')).toBeNull();
  });
});
