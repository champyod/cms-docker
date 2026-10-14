// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { AlertCentre } from '@/app/[locale]/(authenticated)/notifications/AlertCentre';
import { NotificationBell } from '@/components/layout/NotificationBell';
import en from '@/dictionaries/en.json';
import type { AlertRow } from '@/lib/alert-history';
import type { QueuedNotification } from '@/lib/notification-queue';

// Why globals are disabled in vitest.config.ts, so @testing-library/react's
// automatic afterEach cleanup does not run; see audit-detail-error.test.tsx.
afterEach(() => cleanup());

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: router.push,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/en/notifications',
}));

// Why the service is mocked rather than mounted: both surfaces must read its state, and a real
// provider would open the alert stream to reach the same values.
const service = vi.hoisted(() => ({ events: [] as QueuedNotification[], markSeen: vi.fn(), clearEvents: vi.fn() }));
vi.mock('@/lib/live/notifications', () => ({
  useLiveNotifications: () => ({
    events: service.events,
    unread: service.events.length,
    unansweredCount: 0,
    clearEvents: service.clearEvents,
    markSeen: service.markSeen,
  }),
}));

const ALERT: QueuedNotification = {
  id: 'audit-42',
  level: 'critical',
  title: 'Critical action: service:deploy',
  detail: 'Ada ran service:deploy on Midterm',
  timestamp: '2026-10-14T09:00:00.000Z',
};

const ROW: AlertRow = {
  id: '42',
  timestamp: '2026-10-14T09:00:00.000Z',
  verb: 'service:deploy',
  entity: 'deployment',
  entity_name: 'Midterm',
  actor_name: 'Ada',
  result: 'success',
};

function hrefs(): string[] {
  return screen.getAllByRole('link').map((link) => link.getAttribute('href') ?? '');
}

function renderCentre(overrides: Partial<Parameters<typeof AlertCentre>[0]> = {}): void {
  render(
    <AlertCentre
      locale="en"
      copy={en.notifications}
      entries={[]}
      total={0}
      totalPages={1}
      currentPage={1}
      pageSize={25}
      filters={{}}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  service.events = [];
  service.markSeen.mockClear();
  service.clearEvents.mockClear();
  router.push.mockClear();
});

describe('alert centre', () => {
  it('shows the live alerts the service holds, each linking to the audit log', () => {
    service.events = [ALERT];
    renderCentre();

    expect(screen.getByText(ALERT.title)).toBeTruthy();
    expect(hrefs()).toContain('/en/administration/audit');
  });

  it('marks the live alerts read through the shared service', () => {
    service.events = [ALERT];
    renderCentre();

    fireEvent.click(screen.getByRole('button', { name: en.notifications.markAllRead }));

    expect(service.markSeen).toHaveBeenCalledTimes(1);
  });

  it('links every history row to its own audit record', () => {
    renderCentre({ entries: [ROW], total: 1 });

    expect(hrefs()).toContain('/en/administration/audit?entity=deployment&verb=service%3Adeploy');
  });

  it('carries the filters into the query', () => {
    renderCentre();

    fireEvent.change(screen.getByPlaceholderText(en.notifications.filters.searchPlaceholder), {
      target: { value: 'deploy' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.notifications.filters.apply }));

    expect(router.push.mock.calls[0]?.[0]).toBe('?search=deploy&page=1');
  });

  it('pages the history through the one registry route', () => {
    renderCentre({ total: 60, totalPages: 3 });

    fireEvent.click(screen.getByRole('button', { name: '->' }));

    expect(router.push.mock.calls[0]?.[0]).toBe('?page=2');
  });
});

describe('notification bell popup', () => {
  function renderBell(events: readonly QueuedNotification[]): { onClear: () => void; onSeen: () => void } {
    const onClear = vi.fn();
    const onSeen = vi.fn();
    render(<NotificationBell events={events} unread={events.length} onClear={onClear} onSeen={onSeen} />);
    fireEvent.click(screen.getByRole('button', { name: 'System alerts' }));
    return { onClear, onSeen };
  }

  it('opens its own popup with the live alerts and the link to the centre', () => {
    renderBell([ALERT]);

    expect(screen.getByText(ALERT.title)).toBeTruthy();
    expect(hrefs()).toContain('/en/administration/audit');
    expect(hrefs()).toContain('/en/notifications');
  });

  it('marks all read and clears through the callbacks the service handed it', () => {
    const { onClear, onSeen } = renderBell([ALERT]);

    // Opening the panel is itself what clears the bell's count.
    expect(onSeen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(onSeen).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
