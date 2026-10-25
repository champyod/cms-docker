// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SecuritySignalCard } from '@/components/security/SecuritySignalCard';
import en from '@/dictionaries/en.json';
import { buildSecurityDigest } from '@/lib/security/signal';
import {
  currentStaleness,
  makeFinding,
  makeState,
  makeWaiver,
  NOW,
  staleStaleness,
  unknownStalenessFixture,
} from './security-signal-fixture';

const copy = en.security.signal;

function renderCard(findings: Parameters<typeof makeState>[0], waivers: Parameters<typeof makeState>[1] = [], staleness = currentStaleness()): void {
  const state = makeState(findings, waivers);
  render(
    <SecuritySignalCard digest={buildSecurityDigest(state, staleness, NOW)} locale="en" copy={copy} />,
  );
}

afterEach(() => {
  cleanup();
});

describe('security digest card', () => {
  it('shows the counts, names the worst and the oldest item, and links to the detail', () => {
    renderCard(
      [
        makeFinding(1, { severity: 'CRITICAL', subject: 'glibc', firstSeen: '2026-09-01T00:00:00.000Z' }),
        makeFinding(2, { severity: 'HIGH', subject: 'curl' }),
      ],
      [makeWaiver(7, { reviewBy: '2026-10-01T00:00:00.000Z', expired: true })],
    );

    expect(screen.getByText('Security digest')).toBeTruthy();
    expect(screen.getByText(/Oldest unowned/)).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText('Unwaived critical')).toBeTruthy();
    expect(screen.getByText('Unwaived high')).toBeTruthy();
    expect(screen.getByText('Expired waivers')).toBeTruthy();
    expect(screen.getByText(/Worst finding/)).toBeTruthy();
    expect(screen.getAllByText(/rootfs glibc/).length).toBeGreaterThan(0);
    expect(screen.getByText(/54d old/)).toBeTruthy();
    // The link is the detail page, locale-prefixed like every other route in the shell.
    expect(screen.getByRole('link', { name: 'Open patching' }).getAttribute('href')).toBe('/en/security/patching');
  });

  it('says everything is fine once instead of counting zero four times', () => {
    renderCard([]);

    expect(screen.getByText('All clear')).toBeTruthy();
    expect(screen.getByText(copy.clear)).toBeTruthy();
    expect(screen.queryByText('Unwaived critical')).toBeNull();
    expect(screen.queryByText('Worst finding')).toBeNull();
  });

  it('does not claim the backups are healthy when a reading could not be taken', () => {
    renderCard([], [], unknownStalenessFixture('Prometheus is not reachable at http://prometheus:9090'));

    expect(screen.getByText('Partly unreadable')).toBeTruthy();
    expect(screen.getAllByText('cannot evaluate').length).toBe(2);
    expect(screen.getByText(copy.unreadable)).toBeTruthy();
  });

  it('names a stale copy with the hours the producer reported', () => {
    renderCard([], [], staleStaleness());

    expect(screen.getByText('stale')).toBeTruthy();
    expect(screen.getByText(/30h old/)).toBeTruthy();
    expect(screen.getByText('current')).toBeTruthy();
  });

  it('counts a waiver that is about to lapse, with the horizon in the label', () => {
    renderCard([makeFinding(1, { waiver: { status: 'active', reviewBy: '2026-10-30T00:00:00.000Z' } })], [
      makeWaiver(4, { reviewBy: '2026-10-30T00:00:00.000Z' }),
    ]);

    expect(screen.getByText('Waivers due in 7d')).toBeTruthy();
    expect(screen.getByText('Watching')).toBeTruthy();
  });
});
