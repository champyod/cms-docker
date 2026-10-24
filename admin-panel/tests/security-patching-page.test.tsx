// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import en from '@/dictionaries/en.json';
import type { PatchingState } from '@/lib/security/patching';

const mocks = vi.hoisted(() => ({
  authorizeRoutePage: vi.fn(),
  readPatchingState: vi.fn(),
  createPatchingWaiver: vi.fn(),
  endPatchingWaiver: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/navigation/page-authorization', () => ({ authorizeRoutePage: mocks.authorizeRoutePage }));
vi.mock('@/app/actions/securityPatching', () => ({
  readPatchingState: mocks.readPatchingState,
  createPatchingWaiver: mocks.createPatchingWaiver,
  endPatchingWaiver: mocks.endPatchingWaiver,
}));
vi.mock('@/i18n', () => ({ getDictionary: async () => en }));

const EXPIRED_REVIEW = '2026-10-01T00:00:00.000Z';
const ACTIVE_REVIEW = '2026-12-01T00:00:00.000Z';

const STATE: PatchingState = {
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
};

async function renderPage(effective: readonly string[]): Promise<void> {
  mocks.authorizeRoutePage.mockResolvedValue(new Set(effective));
  mocks.readPatchingState.mockResolvedValue(STATE);
  const { default: SecurityPatchingPage } = await import(
    '@/app/[locale]/(authenticated)/security/patching/page'
  );
  render(await SecurityPatchingPage({ params: Promise.resolve({ locale: 'en' }) }));
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
});
