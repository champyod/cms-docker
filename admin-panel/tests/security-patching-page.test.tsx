// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import en from '@/dictionaries/en.json';
import {
  PATCHING_PAGE_SIZE,
  readPatchingQuery,
  type PatchingListState,
} from '@/lib/security/patching';

const mocks = vi.hoisted(() => ({
  authorizeRoutePage: vi.fn(),
  readPatchingFindingsPage: vi.fn(),
  createPatchingWaiver: vi.fn(),
  endPatchingWaiver: vi.fn(),
  push: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/en/security/patching',
}));
vi.mock('@/lib/navigation/page-authorization', () => ({ authorizeRoutePage: mocks.authorizeRoutePage }));
vi.mock('@/app/actions/securityPatching', () => ({
  readPatchingFindingsPage: mocks.readPatchingFindingsPage,
  createPatchingWaiver: mocks.createPatchingWaiver,
  endPatchingWaiver: mocks.endPatchingWaiver,
}));
vi.mock('@/i18n', () => ({ getDictionary: async () => en }));

const EXPIRED_REVIEW = '2026-10-01T00:00:00.000Z';
const ACTIVE_REVIEW = '2026-12-01T00:00:00.000Z';
/** The shape of the live host's feed: far more rows than one page can hold. */
const TOTAL = 34_610;

const STATE: PatchingListState = {
  groups: [
    {
      source: 'rootfs',
      findings: [
        {
          id: 1,
          source: 'rootfs',
          key: 'CVE-2026-1|openssl',
          kind: 'os-package',
          severity: 'CRITICAL',
          subject: 'openssl',
          installed: '1.0',
          available: '1.1',
          title: 'CVE-2026-1',
          url: null,
          host: 'box-a',
          firstSeen: '2026-09-01T00:00:00.000Z',
          lastSeen: '2026-10-24T00:00:00.000Z',
          waiver: { status: 'expired', reviewBy: EXPIRED_REVIEW },
        },
      ],
    },
    {
      source: 'diun',
      findings: [
        {
          id: 2,
          source: 'diun',
          key: 'ghcr.io/example/nginx',
          kind: 'image',
          severity: null,
          subject: 'ghcr.io/example/nginx',
          installed: 'sha256:old',
          available: 'sha256:new',
          title: null,
          url: null,
          host: 'box-b',
          firstSeen: '2026-10-20T00:00:00.000Z',
          lastSeen: '2026-10-24T00:00:00.000Z',
          waiver: { status: 'active', reviewBy: ACTIVE_REVIEW },
        },
      ],
    },
  ],
  waivers: [
    {
      id: 10,
      source: 'rootfs',
      match: 'CVE-2026-1',
      reason: 'waiting on the vendor backport',
      reviewBy: EXPIRED_REVIEW,
      createdAt: '2026-09-01T00:00:00.000Z',
      createdBy: 1,
      createdByName: 'root',
      endedAt: null,
      expired: true,
    },
    {
      id: 11,
      source: 'diun',
      match: 'ghcr.io/example/nginx',
      reason: 'digest pin pending',
      reviewBy: ACTIVE_REVIEW,
      createdAt: '2026-10-20T00:00:00.000Z',
      createdBy: 1,
      createdByName: 'root',
      endedAt: null,
      expired: false,
    },
  ],
  cards: { staleImages: 1, unresolvedCves: 1, expiredWaivers: 1, hostOsUpdates: 1 },
  page: {
    query: { page: 1, source: 'all', severity: 'all', sort: 'lastSeen', direction: 'desc' },
    pageSize: PATCHING_PAGE_SIZE,
    total: TOTAL,
    pageCount: Math.ceil(TOTAL / PATCHING_PAGE_SIZE),
  },
};

async function renderPage(
  effective: readonly string[],
  searchParams: Record<string, string | undefined> = {},
  state: PatchingListState = STATE,
): Promise<void> {
  mocks.authorizeRoutePage.mockResolvedValue(new Set(effective));
  mocks.readPatchingFindingsPage.mockResolvedValue(state);
  const { default: SecurityPatchingPage } = await import(
    '@/app/[locale]/(authenticated)/security/patching/page'
  );
  render(
    await SecurityPatchingPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

describe('security patching page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders unresolved findings grouped by source with version, host and dates', async () => {
    await renderPage(['security:read', 'patching:read']);

    // Both the group heading and the waiver table name the producer family, so this reads as
    // "at least one row says it" rather than "exactly one element does".
    expect(screen.getAllByText('Host OS packages').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Container images').length).toBeGreaterThan(0);
    expect(screen.getAllByText('openssl').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1.0 → 1.1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('box-a').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2026-09-01').length).toBeGreaterThan(0);
    expect(screen.getAllByText('CRITICAL').length).toBeGreaterThan(0);
  });

  it('surfaces an expired waiver distinctly and counts it, while an active one reads as active', async () => {
    await renderPage(['security:read', 'patching:read']);

    expect(screen.getAllByText('expired 2026-10-01').length).toBeGreaterThan(0);
    expect(screen.getAllByText('active until 2026-12-01').length).toBeGreaterThan(0);
    // The dedicated expired section names the reason, so the decision is visible even when
    // the row it covers is gone.
    expect(screen.getAllByText('waiting on the vendor backport').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Expired waivers').length).toBeGreaterThan(0);
  });

  it('lists the waivers with who signed them and when they lapse', async () => {
    await renderPage(['security:read', 'patching:read']);

    // The waiver list is a table of decisions, not a list of ids: the source, what it covers, the
    // reason, the signer and the review date all read off the same row.
    expect(screen.getAllByText('Signed by').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Review by').length).toBeGreaterThan(0);
    expect(screen.getAllByText('root').length).toBeGreaterThan(0);
    // And the page says why a lapsed one matters: the build fails until it is ended or renewed.
    expect(
      screen.getByText(
        '1 waiver(s) are past their review date: CI fails until each one is ended or renewed.',
      ),
    ).toBeTruthy();
  });

  it('offers the waiver write only when the reader holds patching:waive', async () => {
    await renderPage(['security:read', 'patching:read']);
    expect(screen.queryAllByText('Waive').length).toBe(0);

    cleanup();
    await renderPage(['security:read', 'patching:read', 'patching:waive']);
    expect(screen.getAllByText('Waive').length).toBeGreaterThan(0);
  });

  it('hands the raw query string to the read without interpreting it here', async () => {
    // The page is a pass-through: one validator exists (`readPatchingQuery` + `clampPatchingPage`)
    // and the page must not grow a second one that could disagree with it.
    await renderPage(['security:read', 'patching:read'], {
      page: 'not-a-number',
      source: 'renovate',
      severity: 'TERMINAL',
      sort: 'whatever',
    });

    expect(mocks.readPatchingFindingsPage).toHaveBeenCalledWith({
      page: 'not-a-number',
      source: 'renovate',
      severity: 'TERMINAL',
      sort: 'whatever',
    });
    // The rendered controls show the validated view: page 1, both filters open, default sort.
    expect((screen.getByLabelText('Source') as HTMLSelectElement).value).toBe('all');
    expect((screen.getByLabelText('Severity') as HTMLSelectElement).value).toBe('all');
    expect((screen.getByLabelText('Sort by') as HTMLSelectElement).value).toBe('lastSeen');
  });

  it('shows the SQL totals and a pager over the count, not over the rows it was given', async () => {
    await renderPage(['security:read', 'patching:read']);

    const pages = Math.ceil(TOTAL / PATCHING_PAGE_SIZE);
    expect(screen.getByText(`Page 1 of ${String(pages)}`)).toBeTruthy();
    expect(screen.getByText('Showing 1–25 of 34610')).toBeTruthy();
    // Two rows were handed to the page, 34,610 exist: the number comes from the count.
    expect(screen.getAllByText(/34610 findings/).length).toBeGreaterThan(0);
    // The next page is a URL, because the database is what slices the feed.
    const next = screen.getAllByRole('link', { name: 'Next' })[0];
    expect(next.getAttribute('href')).toBe('/en/security/patching?page=2');
  });

  it('navigates with a filter and drops the page number it no longer belongs to', async () => {
    const pages = Math.ceil(TOTAL / PATCHING_PAGE_SIZE);
    const onThirdPage: PatchingListState = {
      ...STATE,
      page: { ...STATE.page, query: { ...STATE.page.query, page: 3 } },
    };
    await renderPage(['security:read', 'patching:read'], { page: '3' }, onThirdPage);
    expect(screen.getByText(`Page 3 of ${String(pages)}`)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'rootfs' } });
    expect(mocks.push).toHaveBeenCalledWith('/en/security/patching?source=rootfs', { scroll: false });

    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'CRITICAL' } });
    expect(mocks.push).toHaveBeenLastCalledWith('/en/security/patching?severity=CRITICAL', { scroll: false });

    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'subject' } });
    expect(mocks.push).toHaveBeenLastCalledWith('/en/security/patching?sort=subject', { scroll: false });
  });
});

describe('query validation', () => {
  it('falls back to a usable query when the URL says nothing usable', () => {
    expect(readPatchingQuery({})).toEqual({
      page: 1,
      source: 'all',
      severity: 'all',
      sort: 'lastSeen',
      direction: 'desc',
    });
    expect(readPatchingQuery({ page: '0' }).page).toBe(1);
    expect(readPatchingQuery({ page: '-4' }).page).toBe(1);
    expect(readPatchingQuery({ page: '12.5' }).page).toBe(1);
    expect(readPatchingQuery({ page: 'abc' }).page).toBe(1);
    expect(readPatchingQuery({ page: ' 42 ' }).page).toBe(42);
    expect(readPatchingQuery({ source: 'renovate' }).source).toBe('all');
    expect(readPatchingQuery({ severity: 'TERMINAL' }).severity).toBe('all');
    expect(readPatchingQuery({ sort: 'whatever' }).sort).toBe('lastSeen');
    expect(readPatchingQuery({ dir: 'sideways' }).direction).toBe('desc');
  });

  it('keeps a real filter and a real sort, and defaults the direction to the column', () => {
    expect(readPatchingQuery({ source: 'rootfs', severity: 'HIGH' })).toEqual({
      page: 1,
      source: 'rootfs',
      severity: 'HIGH',
      sort: 'lastSeen',
      direction: 'desc',
    });
    expect(readPatchingQuery({ sort: 'subject' }).direction).toBe('asc');
    expect(readPatchingQuery({ sort: 'subject', dir: 'desc' }).direction).toBe('desc');
  });
});
