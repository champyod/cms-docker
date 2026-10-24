'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useLiveStream } from '@/hooks/useLiveStream';
import { useDictionary } from '@/hooks/useDictionary';
import { interpolate } from '@/lib/interpolate';
import { deliverSystemEvent } from '@/lib/live/alert-delivery';
import { requestDeviceNotifications } from '@/lib/live/device-notifications';
import { cursorFromFrameId, isNewFrame, type QueuedNotification } from '@/lib/notification-queue';
import { hasEffectivePermission } from '@/lib/permission-engine';
import type { QuestionsFrame } from '@/lib/live/frames';

const ALERT_STREAM_URL = '/api/notifications/stream';
const QUESTION_STREAM_URL = '/api/questions/stream';
const MAX_EVENTS = 20;

export interface LiveNotifications {
  readonly events: readonly QueuedNotification[];
  readonly unread: number;
  readonly unansweredCount: number;
  clearEvents: () => void;
  markSeen: () => void;
}

const LiveNotificationsContext = createContext<LiveNotifications | null>(null);

/**
 * The panel's one notification service, fed by the live streams and read by the alert bell and the
 * unanswered-question dot.
 *
 * Why both signals share one service: they are the same notification surface seen from two channels,
 * and keeping their dedup, their alerting and their device notifications in one place is what stops a
 * reconnect from alerting twice or the two channels from drifting apart.
 *
 * Why both channels stay connected while the tab is hidden: this service exists to reach an operator
 * who is not looking at the panel, and a channel that closes on `visibilitychange` can never do that.
 * The pause other surfaces take is a cost they pay for sampling nobody; here nobody looking is exactly
 * the case the channel is for.
 */
export function LiveNotificationProvider({
  permissionKeys,
  children,
}: {
  permissionKeys: readonly string[];
  children: React.ReactNode;
}): React.JSX.Element {
  const keys = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  // Why the copy is read here and not built in the cue: an OS notification leaves the panel, so its
  // words are the operator's locale's, exactly like every other string the shell renders.
  const cueCopy = useDictionary().systemAlerts;
  const [events, setEvents] = useState<QueuedNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [unansweredCount, setUnansweredCount] = useState(0);
  const [alertCursor, setAlertCursor] = useState(0);
  const seenAlertIds = useRef<Set<string>>(new Set());
  const lastAlertedQuestionId = useRef(0);

  useEffect(() => {
    requestDeviceNotifications();
  }, []);

  const onAlert = useCallback((frame: QueuedNotification): void => {
    if (typeof frame.id !== 'string') return;
    // Why the guard sits before every side effect: a reconnect replays the backlog, and the list
    // dedup below used to swallow the repeat while the toast still fired a second time.
    if (!isNewFrame(seenAlertIds.current, frame.id)) return;
    seenAlertIds.current.add(frame.id);
    setAlertCursor((previous) => cursorFromFrameId(previous, frame.id));
    setEvents((previous) => [frame, ...previous].slice(0, MAX_EVENTS));
    setUnread((count) => count + 1);
    // Why the record is written before the cue: the bell's list is this event's history whatever
    // surface carries it, and the decision below only says which one cue goes beside it.
    deliverSystemEvent(frame);
  }, []);

  const onQuestions = useCallback((frame: QuestionsFrame): void => {
    setUnansweredCount(frame.unansweredCount);
    const latest = frame.latest;
    // Why the id and not the question's timestamp: ids only ever move forward, so an older question
    // coming back into view after a reply is not an arrival, and two clocks cannot disagree.
    if (latest === null || latest.id <= lastAlertedQuestionId.current) return;
    lastAlertedQuestionId.current = latest.id;
    // Why the cue and not a toast: a question is a task for an admin, so it keeps the one surface
    // every other system event has — the header's dot while the panel is on screen, exactly one OS
    // notification while it is not. A persistent toast beside the dot was the same arrival twice.
    deliverSystemEvent({
      id: `question-${latest.id}`,
      title: cueCopy.questionTitle,
      detail: interpolate(cueCopy.questionDetail, {
        username: latest.username ?? cueCopy.questionUnnamedAsker,
        subject: latest.subject,
      }),
    });
  }, [cueCopy]);

  // Why the cursor travels in the url: the stream replays its backlog on every (re)connect, and
  // `since` narrows that replay to frames this viewer is still missing.
  useLiveStream<QueuedNotification>({
    url: `${ALERT_STREAM_URL}?since=${alertCursor}`,
    onFrame: onAlert,
    enabled: hasEffectivePermission(keys, 'audit:read'),
    followHidden: true,
  });
  useLiveStream<QuestionsFrame>({
    url: QUESTION_STREAM_URL,
    onFrame: onQuestions,
    enabled: hasEffectivePermission(keys, 'question:list'),
    followHidden: true,
  });

  const value = useMemo<LiveNotifications>(
    () => ({
      events,
      unread,
      unansweredCount,
      clearEvents: () => setEvents([]),
      markSeen: () => setUnread(0),
    }),
    [events, unread, unansweredCount],
  );

  return <LiveNotificationsContext.Provider value={value}>{children}</LiveNotificationsContext.Provider>;
}

/** Why it throws instead of falling back: a consumer outside the provider would silently lose alerts. */
export function useLiveNotifications(): LiveNotifications {
  const value = useContext(LiveNotificationsContext);
  if (value === null) throw new Error('useLiveNotifications needs a LiveNotificationProvider above it');
  return value;
}
