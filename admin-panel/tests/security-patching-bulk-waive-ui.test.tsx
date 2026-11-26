// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import type { PatchingListState } from '@/lib/security/patching';
import type { BulkWaiveResult } from '@/lib/panel-actions/patching-bulk-waive';

/**
 * The bulk waiver as the operator meets it: a button, a dry run, and a confirmation that states the
 * counts and the review date before anything is written.
 */
const mocks = vi.hoisted(() => ({
  bulkWaiveUnreachable: vi.fn(),
  createPatchingWaiver: vi.fn(),
  endPatchingWaiver: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/en/security/patching',
}));
vi.mock('@/app/actions/securityPatching', () => ({
  bulkWaiveUnreachable: mocks.bulkWaiveUnreachable,
  createPatchingWaiver: mocks.createPatchingWaiver,
  endPatchingWaiver: mocks.endPatchingWaiver,
}));

import { PatchingPanel } from '@/components/security/PatchingPanel';

const STATE: PatchingListState = {
  groups: [],
  waivers: [],
  cards: { staleImages: 0, unresolvedCves: 0, expiredWaivers: 0, hostOsUpdates: 0 },
  // The resolved query shape: `readPatchingQuery` fills `flip` from the URL, defaulting to 'all'.
  page: {
    query: {
      source: 'all', severity: 'all', reachability: 'all', flip: 'all',
      sort: 'lastSeen', direction: 'desc', page: 1,
    },
    pageSize: 25,
    total: 0,
    pageCount: 1,
  },
  waivedReachable: 0,
};

// WHY a generous window: a React transition under a loaded suite can take longer than the 1s default,
// and a timeout here would read as a broken dialog rather than a slow machine.
const WAIT = { timeout: 5000 };

const PLAN: BulkWaiveResult = {
  success: true,
  dryRun: true,
  reviewBy: '2026-12-31',
  counts: {
    candidates: 2395,
    alreadyWaived: 12,
    refusedReachable: 1,
    refusedUnknown: 2,
    findingsWaived: 2380,
    planned: 479,
    waived: 0,
  },
  plan: [],
  refusals: [{ key: 'CVE-2026-1|linux-image-5.15.0-203', cve: 'CVE-2026-1', host: 'como-main', verdict: 'reachable', own: 'reachable' }],
  waiverIds: [],
  failures: [],
};

function renderPanel(canWaive: boolean): ReturnType<typeof render> {
  return render(<PatchingPanel state={STATE} copy={en.security.patching} canWaive={canWaive} />);
}

/** The dialog's date field: the shared Input does not wire `label` to an id, so it is found by type. */
function dateField(): HTMLInputElement {
  const field = document.querySelector<HTMLInputElement>('input[type="date"]');
  if (field === null) throw new Error('the review date field is missing');
  return field;
}

describe('the bulk waiver on the patching page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bulkWaiveUnreachable.mockResolvedValue(PLAN);
  });
  afterEach(cleanup);

  it('offers the action only to a reader who may waive', () => {
    const { unmount } = renderPanel(false);
    expect(screen.queryByRole('button', { name: en.security.patching.bulkWaive.button })).toBeNull();
    unmount();
    renderPanel(true);
    expect(screen.getByRole('button', { name: en.security.patching.bulkWaive.button })).toBeTruthy();
  });

  it('previews the plan, states the counts and the review date, then applies the same plan', async () => {
    renderPanel(true);
    fireEvent.click(screen.getByRole('button', { name: en.security.patching.bulkWaive.button }));
    // Waiting for the field rather than reaching for it: the dialog mounts asynchronously.
    const date = await waitFor(dateField, WAIT);
    fireEvent.change(date, { target: { value: '2026-12-31' } });
    expect(date.value).toBe('2026-12-31');

    // WHY `act` around the presses: the dialog runs its call inside a transition, and awaiting the
    // act scope is what flushes that work deterministically instead of racing a polling wait.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.security.patching.bulkWaive.preview }));
    });

    expect(mocks.bulkWaiveUnreachable).toHaveBeenCalledWith({ reviewBy: '2026-12-31', dryRun: true });
    expect(screen.getByText('479')).toBeTruthy();
    expect(screen.getByText('2395')).toBeTruthy();
    expect(screen.getByText('CVE-2026-1|linux-image-5.15.0-203')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Waive 479 CVEs' }));
    });
    expect(mocks.bulkWaiveUnreachable).toHaveBeenCalledWith({ reviewBy: '2026-12-31', dryRun: false, expectedWaivers: 479 });
  });

  it('renders the action in Thai from the Thai dictionary', () => {
    render(<PatchingPanel state={STATE} copy={th.security.patching} canWaive />);
    expect(screen.getByRole('button', { name: th.security.patching.bulkWaive.button })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: th.security.patching.bulkWaive.button }));
    expect(screen.getByText(th.security.patching.bulkWaive.title)).toBeTruthy();
    expect(screen.getByText(th.security.patching.bulkWaive.reviewByLabel)).toBeTruthy();
  });
});
