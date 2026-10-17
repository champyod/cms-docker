// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { NotificationPopup } from '@/components/layout/NotificationPopup';
import type { QueuedNotification } from '@/lib/notification-queue';

// Why the pathname is supplied: the panel resolves the locale its links are built with from the
// router, which a bare render does not provide.
vi.mock('next/navigation', () => ({ usePathname: () => '/en/administration/audit' }));

// Why globals are disabled in vitest.config.ts, so @testing-library/react's
// automatic afterEach cleanup does not run; see audit-detail-error.test.tsx.
afterEach(() => cleanup());

const noop = (): void => undefined;

function alert(overrides: Partial<QueuedNotification> = {}): QueuedNotification {
  return {
    id: 'audit-42',
    level: 'critical',
    title: 'Critical action: service:deploy',
    detail: 'Ada ran service:deploy on Midterm',
    timestamp: '2026-10-14T09:00:00.000Z',
    destination: 'administration.audit',
    ...overrides,
  };
}

function renderPopup(events: readonly QueuedNotification[]): void {
  render(<NotificationPopup events={events} onClear={noop} onMarkAllRead={noop} />);
}

describe('alert popup entries', () => {
  it('links an alert that carries a destination to the route it names', () => {
    renderPopup([alert()]);

    expect(screen.getByRole('link').getAttribute('href')).toBe('/en/administration/audit');
    expect(screen.getByText('Critical action: service:deploy')).toBeTruthy();
  });

  it('renders an alert with no destination as text, never as a dead link', () => {
    renderPopup([alert({ destination: undefined })]);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Critical action: service:deploy')).toBeTruthy();
    expect(screen.getByText('Ada ran service:deploy on Midterm')).toBeTruthy();
  });

  it('keeps an alert the panel has no page for on the same list as the linked ones', () => {
    renderPopup([
      alert({ id: 'audit-1' }),
      alert({ id: 'audit-2', title: 'Submit burst', detail: '20 submissions in a minute', destination: undefined }),
    ]);

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('says so instead of showing an empty list when no alert has arrived', () => {
    renderPopup([]);

    expect(screen.getByText('No alerts yet.')).toBeTruthy();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
