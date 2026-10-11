'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { getContestCountdown } from '@/app/actions/contests';
import type { ContestCountdownData } from '@/lib/queries/contest-detail';
import {
  COUNTDOWN_THRESHOLD_UNITS,
  DEFAULT_COUNTDOWN_THRESHOLD,
  DEFAULT_COUNTDOWN_TIMEZONE,
  isSupportedTimezone,
  type ContestPhase,
  type CountdownThreshold,
} from '@/lib/contest-countdown';

const TICK_MS = 1000;
const CONFIG_POLL_MS = 15000;
const ALERT_TOAST_MS = 10000;
const TIMEZONE_STORAGE_KEY = 'contest-countdown-timezone';
const TIMEZONE_EVENT = 'contest-countdown-timezone-change';

/** Live timing: a per-second clock plus a slow repoll so edited times hot-reload. */
export function useCountdownTiming(initial: ContestCountdownData): {
  timing: ContestCountdownData;
  now: Date;
} {
  const [timing, setTiming] = useState(initial);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const contestId = timing.id;
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const result = await getContestCountdown(contestId);
        if (!cancelled && result) setTiming(result);
      } catch (error: unknown) {
        console.warn('Countdown config poll failed:', error);
      }
    };
    const interval = window.setInterval(() => { void poll(); }, CONFIG_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [timing.id]);

  return { timing, now };
}

/** Toasts once on each real transition, not on the initial phase. */
export function usePhaseNotifications(name: string, phase: ContestPhase): void {
  const previousPhase = useRef(phase);
  useEffect(() => {
    const previous = previousPhase.current;
    previousPhase.current = phase;
    if (previous === phase) return;
    if (phase === 'running' && previous === 'not_started') {
      toast.success(`${name} has started.`, { duration: ALERT_TOAST_MS });
    } else if (phase === 'ended' && previous !== 'ended') {
      toast(`${name} has ended.`, { duration: ALERT_TOAST_MS });
    }
  }, [phase, name]);
}

function subscribeTimezone(onStoreChange: () => void): () => void {
  window.addEventListener('storage', onStoreChange);
  window.addEventListener(TIMEZONE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', onStoreChange);
    window.removeEventListener(TIMEZONE_EVENT, onStoreChange);
  };
}

function readTimezone(): string {
  const saved = window.localStorage.getItem(TIMEZONE_STORAGE_KEY);
  return saved && isSupportedTimezone(saved) ? saved : DEFAULT_COUNTDOWN_TIMEZONE;
}

/** The chosen zone as an external store, so a mount effect never has to setState. */
export function useCountdownTimezone(): { timezone: string; setTimezone: (timeZone: string) => void } {
  const timezone = useSyncExternalStore(subscribeTimezone, readTimezone, () => DEFAULT_COUNTDOWN_TIMEZONE);
  const setTimezone = useCallback((timeZone: string): void => {
    window.localStorage.setItem(TIMEZONE_STORAGE_KEY, timeZone);
    window.dispatchEvent(new Event(TIMEZONE_EVENT));
  }, []);
  return { timezone, setTimezone };
}

const THRESHOLD_STORAGE_KEY = 'contest-countdown-threshold';
const THRESHOLD_EVENT = 'contest-countdown-threshold-change';

/** Cleared fields persist as a non-finite amount, which JSON writes as null and back. */
export function serializeCountdownThreshold(next: CountdownThreshold): string {
  return JSON.stringify(next);
}

export function parseCountdownThreshold(raw: string | null): CountdownThreshold {
  if (!raw) return DEFAULT_COUNTDOWN_THRESHOLD;
  try {
    const parsed = JSON.parse(raw) as Partial<CountdownThreshold>;
    const unit = COUNTDOWN_THRESHOLD_UNITS.find((candidate) => candidate === parsed.unit);
    if (!unit) return DEFAULT_COUNTDOWN_THRESHOLD;
    if (parsed.amount === null) return { amount: Number.NaN, unit };
    if (typeof parsed.amount === 'number') return { amount: parsed.amount, unit };
    return DEFAULT_COUNTDOWN_THRESHOLD;
  } catch (error: unknown) {
    console.warn('Ignoring unreadable countdown threshold:', error);
    return DEFAULT_COUNTDOWN_THRESHOLD;
  }
}

// Cached: useSyncExternalStore needs a stable snapshot for an unchanged value.
let cachedThresholdRaw: string | null = null;
let cachedThreshold: CountdownThreshold = DEFAULT_COUNTDOWN_THRESHOLD;

function readThreshold(): CountdownThreshold {
  const raw = window.localStorage.getItem(THRESHOLD_STORAGE_KEY);
  if (raw !== cachedThresholdRaw) {
    cachedThresholdRaw = raw;
    cachedThreshold = parseCountdownThreshold(raw);
  }
  return cachedThreshold;
}

function subscribeThreshold(onStoreChange: () => void): () => void {
  window.addEventListener('storage', onStoreChange);
  window.addEventListener(THRESHOLD_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', onStoreChange);
    window.removeEventListener(THRESHOLD_EVENT, onStoreChange);
  };
}

/** The hurry window as an external store, defaulting to five minutes until changed. */
export function useCountdownThreshold(): {
  threshold: CountdownThreshold;
  setThreshold: (next: CountdownThreshold) => void;
} {
  const threshold = useSyncExternalStore(subscribeThreshold, readThreshold, () => DEFAULT_COUNTDOWN_THRESHOLD);
  const setThreshold = useCallback((next: CountdownThreshold): void => {
    window.localStorage.setItem(THRESHOLD_STORAGE_KEY, serializeCountdownThreshold(next));
    window.dispatchEvent(new Event(THRESHOLD_EVENT));
  }, []);
  return { threshold, setThreshold };
}
