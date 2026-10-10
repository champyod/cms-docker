'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import { toast } from 'sonner';
import { getContestCountdown } from '@/app/actions/contests';
import type { ContestCountdownData } from '@/lib/queries/contest-detail';
import { DEFAULT_COUNTDOWN_TIMEZONE, isSupportedTimezone, type ContestPhase } from '@/lib/contest-countdown';

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

export function useElementFullscreen<T extends HTMLElement>(
  elementRef: RefObject<T | null>,
): { isFullscreen: boolean; toggle: () => void } {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleChange = (): void => setIsFullscreen(document.fullscreenElement === elementRef.current);
    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, [elementRef]);

  const toggle = useCallback((): void => {
    const element = elementRef.current;
    if (!element) return;
    const action = document.fullscreenElement === element ? document.exitFullscreen() : element.requestFullscreen();
    action.catch((error: unknown) => console.error('Fullscreen toggle failed:', error));
  }, [elementRef]);

  return { isFullscreen, toggle };
}
