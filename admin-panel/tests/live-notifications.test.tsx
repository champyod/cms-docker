// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveNotificationProvider, useLiveNotifications } from '@/lib/live/notifications';
import type { QuestionsFrame } from '@/lib/live/frames';
import type { QueuedNotification } from '@/lib/notification-queue';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { interpolate } from '@/lib/interpolate';
import { auditCueCopy } from '@/lib/system-alert-copy';
import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import { memoryStorage } from './memory-storage';

interface StreamOptions {
  url: string;
  onFrame: (frame: unknown) => void;
  enabled?: boolean;
  followHidden?: boolean;
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
  cue: { kind: 'critical', verb: 'admin:delete', actor: 'Ada', target: 'admin #4' },
  timestamp: '2026-10-13T09:00:00.000Z',
};

const QUESTION: QuestionsFrame = {
  unansweredCount: 1,
  latest: { id: 4, subject: 'How do I rejudge?', username: 'ada', askedAt: '2026-10-13T09:00:00.000Z' },
};

/** Whether the tab this service runs in is on screen; every test states it before it renders. */
let panelHidden = false;

function Probe(): React.JSX.Element {
  const { unread, unansweredCount } = useLiveNotifications();
  return <span>{`unread:${unread} questions:${unansweredCount}`}</span>;
}

function renderService(permissionKeys: readonly string[], dict: typeof en = en): ReturnType<typeof render> {
  return render(
    <DictionaryProvider dict={dict}>
      <LiveNotificationProvider permissionKeys={permissionKeys}>
        <Probe />
      </LiveNotificationProvider>
    </DictionaryProvider>,
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
  panelHidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => panelHidden });
  // Why a fresh store per case: the claim is shared between tabs, so it survives a remount and would
  // otherwise leak the previous case's claim into the next.
  vi.stubGlobal('localStorage', memoryStorage());
  streams.opened = [];
  device.notifyDevice.mockReset();
  device.requestDeviceNotifications.mockReset();
  toast.error.mockReset();
  toast.warning.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

  it('keeps both channels open while the tab is hidden, so an alert can still reach the operator', () => {
    renderService(['audit:read']);

    // Why the channels ask for this: a channel that closed on the hide could never alert a tab
    // nobody was looking at, which is the only case an OS notification exists for.
    expect(channel('/api/notifications/stream').followHidden).toBe(true);
    expect(channel('/api/questions/stream').followHidden).toBe(true);
  });

  it('counts an alert once, however often the backlog replays it', () => {
    renderService(['audit:read']);
    const alerts = channel('/api/notifications/stream');

    deliver(alerts, ALERT);
    deliver(alerts, ALERT);

    expect(screen.getByText('unread:1 questions:0')).toBeTruthy();
    expect(device.notifyDevice).not.toHaveBeenCalled();
  });

  it('raises no second surface while the operator is looking at the panel', () => {
    renderService(['audit:read']);
    deliver(channel('/api/notifications/stream'), ALERT);

    // Why both: the toast and the OS notification are the two surfaces the bell's own list already
    // covers, and one arrival is one surface.
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(device.notifyDevice).not.toHaveBeenCalled();
  });

  it('posts exactly one OS notification when the panel is not on screen', () => {
    panelHidden = true;
    renderService(['audit:read']);

    deliver(channel('/api/notifications/stream'), ALERT);

    expect(device.notifyDevice).toHaveBeenCalledTimes(1);
    // Why the expected words come from the dictionary: the frame carries parts, so the OS notification is
    // the reader's locale, and a test that spelled the sentence out would pass while the panel showed English.
    const expected = auditCueCopy(ALERT.cue, en.systemAlerts.audit);
    expect(device.notifyDevice).toHaveBeenCalledWith(expected.title, expected.detail);
    expect(toast.error).not.toHaveBeenCalled();
    // Why the count still moves: the notification is the cue outside the panel, not a replacement for
    // the record the panel keeps for the operator's return.
    expect(screen.getByText('unread:1 questions:0')).toBeTruthy();
  });

  it('speaks the reader’s locale in the OS notification, not the server’s English', () => {
    panelHidden = true;
    renderService(['audit:read'], th);
    deliver(channel('/api/notifications/stream'), ALERT);

    // Why Thai plus an inequality: the frame used to carry a sentence the server had already written in
    // English, and a single-locale assertion cannot tell a translation from that sentence.
    const thai = auditCueCopy(ALERT.cue, th.systemAlerts.audit);
    expect(device.notifyDevice).toHaveBeenCalledWith(thai.title, thai.detail);
    expect(thai.detail).not.toBe(auditCueCopy(ALERT.cue, en.systemAlerts.audit).detail);
  });

  it('leaves the notification to the tab that claimed the event', () => {
    panelHidden = true;
    const first = renderService(['audit:read']);
    deliver(channel('/api/notifications/stream'), ALERT);
    first.unmount();

    // A second tab has its own connection, its own seen-set and its own record; only the claim is
    // shared, which is what keeps one arrival from becoming one notification per tab.
    renderService(['audit:read']);
    deliver(channel('/api/notifications/stream'), ALERT);

    expect(device.notifyDevice).toHaveBeenCalledTimes(1);
    expect(screen.getByText('unread:1 questions:0')).toBeTruthy();
  });

  it('carries the alert cursor forward so a reconnect does not replay it', () => {
    renderService(['audit:read']);
    deliver(channel('/api/notifications/stream'), ALERT);

    expect(channel('/api/notifications/stream').url).toBe('/api/notifications/stream?since=9');
  });

  it('reports the unanswered count without a cue of its own', () => {
    renderService(['question:list']);
    const questions = channel('/api/questions/stream');

    deliver(questions, QUESTION);
    deliver(questions, QUESTION);

    expect(screen.getByText('unread:0 questions:1')).toBeTruthy();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(device.notifyDevice).not.toHaveBeenCalled();
  });

  it('notifies once for a question when the panel is not on screen', () => {
    panelHidden = true;
    renderService(['question:list']);

    deliver(channel('/api/questions/stream'), QUESTION);

    expect(device.notifyDevice).toHaveBeenCalledTimes(1);
    // Why the dictionary and not a literal: this copy leaves the panel as an OS notification, so it
    // is the operator's locale's copy — the assertion would pass just as well on a hardcoded string
    // only if the string were this exact one in both files, which the next case rules out.
    expect(device.notifyDevice).toHaveBeenCalledWith(
      en.systemAlerts.questionTitle,
      interpolate(en.systemAlerts.questionDetail, { username: 'ada', subject: 'How do I rejudge?' }),
    );
  });

  it('sends the question cue in the panel locale, not in English', () => {
    panelHidden = true;
    renderService(['question:list'], th);

    deliver(channel('/api/questions/stream'), QUESTION);

    // The two files disagree on every one of these words, so a string baked into the service cannot
    // satisfy this case and the English one above at the same time.
    expect(th.systemAlerts.questionTitle).not.toBe(en.systemAlerts.questionTitle);
    expect(th.systemAlerts.questionDetail).not.toBe(en.systemAlerts.questionDetail);
    expect(device.notifyDevice).toHaveBeenCalledWith(
      th.systemAlerts.questionTitle,
      interpolate(th.systemAlerts.questionDetail, { username: 'ada', subject: 'How do I rejudge?' }),
    );
  });

  it('names an asker who left no username in the panel locale', () => {
    panelHidden = true;
    renderService(['question:list'], th);

    deliver(channel('/api/questions/stream'), { ...QUESTION, latest: { ...QUESTION.latest, username: null } });

    expect(device.notifyDevice).toHaveBeenCalledWith(
      th.systemAlerts.questionTitle,
      interpolate(th.systemAlerts.questionDetail, {
        username: th.systemAlerts.questionUnnamedAsker,
        subject: 'How do I rejudge?',
      }),
    );
  });

  it('does not alert again when an older question is the newest one left', () => {
    panelHidden = true;
    renderService(['question:list']);
    const questions = channel('/api/questions/stream');

    deliver(questions, QUESTION);
    deliver(questions, { unansweredCount: 1, latest: { ...QUESTION.latest, id: 2 } });

    expect(device.notifyDevice).toHaveBeenCalledTimes(1);
    expect(screen.getByText('unread:0 questions:1')).toBeTruthy();
  });

  it('asks for the device-notification grant on mount, not on every alert', () => {
    renderService(['audit:read']);
    deliver(channel('/api/notifications/stream'), ALERT);
    expect(device.requestDeviceNotifications).toHaveBeenCalledTimes(1);
  });
});
