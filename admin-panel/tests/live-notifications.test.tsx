// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveNotificationProvider, useLiveNotifications } from '@/lib/live/notifications';
import type { QuestionsFrame } from '@/lib/live/frames';
import type { QueuedNotification } from '@/lib/notification-queue';

interface StreamOptions {
  url: string;
  onFrame: (frame: unknown) => void;
  enabled?: boolean;
}

const streams = vi.hoisted(() => ({ opened: [] as StreamOptions[] }));
const device = vi.hoisted(() => ({ notifyDevice: vi.fn(), requestDeviceNotifications: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }));

vi.mock('@/hooks/useLiveStream', () => ({
  useLiveStream: (options: StreamOptions) => {
    streams.opened.push(options);
    return { status: 'live', refresh: vi.fn() };
  },
}));
vi.mock('@/lib/live/device-notifications', () => device);
vi.mock('sonner', () => ({ toast }));

const ALERT: QueuedNotification = {
  id: 'audit-9',
  level: 'critical',
  title: 'Critical action: admin:delete',
  detail: 'Ada ran admin:delete on admin #4',
  timestamp: '2026-10-13T09:00:00.000Z',
};

const QUESTION: QuestionsFrame = {
  unansweredCount: 1,
  latest: { id: 4, subject: 'How do I rejudge?', username: 'ada', askedAt: '2026-10-13T09:00:00.000Z' },
};

function Probe(): React.JSX.Element {
  const { unread, unansweredCount } = useLiveNotifications();
  return <span>{`unread:${unread} questions:${unansweredCount}`}</span>;
}

function renderService(permissionKeys: readonly string[]): void {
  render(
    <LiveNotificationProvider permissionKeys={permissionKeys}>
      <Probe />
    </LiveNotificationProvider>,
  );
}

/** The connection the service opened for one channel; the mock records one per render. */
function channel(prefix: string): StreamOptions {
  const opened = streams.opened.filter((options) => options.url.startsWith(prefix));
  const latest = opened[opened.length - 1];
  if (latest === undefined) throw new Error(`the service never opened ${prefix}`);
  return latest;
}

function deliver(options: StreamOptions, frame: unknown): void {
  act(() => options.onFrame(frame));
}

beforeEach(() => {
  streams.opened = [];
  device.notifyDevice.mockReset();
  device.requestDeviceNotifications.mockReset();
  toast.error.mockReset();
  toast.warning.mockReset();
});

afterEach(() => cleanup());

/**
 * The panel's one notification service: both channels feed one state, and neither the bell nor the
 * question dot can alert twice for the same arrival.
 */
describe('live notification service', () => {
  it('opens the alert and question channels only for the keys the viewer holds', () => {
    renderService(['audit:read']);

    expect(channel('/api/notifications/stream').enabled).toBe(true);
    expect(channel('/api/questions/stream').enabled).toBe(false);
  });

  it('counts an alert once, however often the backlog replays it', () => {
    renderService(['audit:read']);
    const alerts = channel('/api/notifications/stream');

    deliver(alerts, ALERT);
    deliver(alerts, ALERT);

    expect(screen.getByText('unread:1 questions:0')).toBeTruthy();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(device.notifyDevice).toHaveBeenCalledTimes(1);
  });

  it('carries the alert cursor forward so a reconnect does not replay it', () => {
    renderService(['audit:read']);
    deliver(channel('/api/notifications/stream'), ALERT);

    expect(channel('/api/notifications/stream').url).toBe('/api/notifications/stream?since=9');
  });

  it('reports the unanswered count and alerts on a new question once', () => {
    renderService(['question:list']);
    const questions = channel('/api/questions/stream');

    deliver(questions, QUESTION);
    deliver(questions, QUESTION);

    expect(screen.getByText('unread:0 questions:1')).toBeTruthy();
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(device.notifyDevice).toHaveBeenCalledTimes(1);
  });

  it('does not alert again when an older question is the newest one left', () => {
    renderService(['question:list']);
    const questions = channel('/api/questions/stream');

    deliver(questions, QUESTION);
    deliver(questions, { unansweredCount: 1, latest: { ...QUESTION.latest, id: 2 } });

    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(screen.getByText('unread:0 questions:1')).toBeTruthy();
  });

  it('asks for the device-notification grant on mount, not on every alert', () => {
    renderService(['audit:read']);
    deliver(channel('/api/notifications/stream'), ALERT);
    expect(device.requestDeviceNotifications).toHaveBeenCalledTimes(1);
  });
});
