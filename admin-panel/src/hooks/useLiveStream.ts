'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  LIVE_IDLE_TIMEOUT_MS,
  LIVE_RECONNECT_MAX_MS,
  LIVE_RECONNECT_MIN_MS,
  LIVE_WATCHDOG_CHECK_MS,
} from '@/lib/constants/live-stream';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'paused';

interface UseLiveStreamOptions<TFrame> {
  /** The stream to watch. Changing it reopens the connection, which is how a query parameter is re-read. */
  url: string;
  onFrame: (frame: TFrame) => void;
}

export interface LiveStream {
  status: LiveStatus;
  /** Reopens the stream so the server sends a fresh snapshot now — used after the user changes something. */
  refresh: () => void;
}

/**
 * Watches one server-push channel for as long as the component is mounted.
 *
 * Why the browser's own EventSource retry is not used: it is a fixed delay with no ceiling, so a
 * panel that is down gets hammered by every open tab. Here every `error` closes the source and hands
 * the reconnection to a doubling backoff, which also keeps exactly one source alive at a time.
 *
 * Why a hidden tab lets go of the stream: the pollers this replaces skipped their work while the tab
 * was hidden, and a stream would otherwise keep the server sampling for a tab nobody is looking at.
 * The reconnect on focus brings the panel back with a fresh snapshot.
 */
export function useLiveStream<TFrame>({ url, onFrame }: UseLiveStreamOptions<TFrame>): LiveStream {
  // Why the initial state is read from the document: a tab that mounted in the background must not
  // open a connection at all, and a status set from inside the effect would be a cascading render.
  const [status, setStatus] = useState<LiveStatus>(() =>
    typeof document !== 'undefined' && document.hidden ? 'paused' : 'connecting'
  );
  const onFrameRef = useRef(onFrame);
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFrameAtRef = useRef(0);
  const attemptsRef = useRef(0);
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    onFrameRef.current = onFrame;
  });

  useEffect(() => {
    let disposed = false;

    const clearReconnect = (): void => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const closeSource = (): void => {
      if (sourceRef.current !== null) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
    };

    const scheduleReconnect = (): void => {
      if (disposed) return;
      closeSource();
      if (reconnectTimerRef.current !== null) return;
      setStatus('reconnecting');
      const delay = Math.min(LIVE_RECONNECT_MAX_MS, LIVE_RECONNECT_MIN_MS * 2 ** attemptsRef.current);
      attemptsRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };

    const connect = (): void => {
      if (disposed) return;
      // Closing first is what makes "one refresh at a time" true: a second source can never exist
      // while the previous one is still being torn down.
      closeSource();
      lastFrameAtRef.current = Date.now();
      setStatus('connecting');

      const source = new EventSource(url);
      sourceRef.current = source;

      source.onopen = () => {
        if (disposed || sourceRef.current !== source) return;
        attemptsRef.current = 0;
        setStatus('live');
      };

      source.onmessage = (event) => {
        if (disposed || sourceRef.current !== source) return;
        // The frame clock is reset by every frame, including heartbeats, so it measures the
        // connection and never the data.
        lastFrameAtRef.current = Date.now();
        setStatus('live');
        try {
          onFrameRef.current(JSON.parse(event.data) as TFrame);
        } catch {
          // A malformed frame is dropped; the watchdog below still bounds the connection's lifetime.
        }
      };

      source.onerror = () => {
        if (disposed || sourceRef.current !== source) return;
        scheduleReconnect();
      };
    };

    const onVisibilityChange = (): void => {
      if (document.hidden) {
        clearReconnect();
        closeSource();
        setStatus('paused');
        return;
      }
      attemptsRef.current = 0;
      clearReconnect();
      connect();
    };

    refreshRef.current = () => {
      attemptsRef.current = 0;
      clearReconnect();
      if (document.hidden) return;
      // A reconnect already in flight will deliver a fresh snapshot on its own, so a second one would
      // only add a connection without adding freshness.
      if (sourceRef.current !== null && sourceRef.current.readyState === EventSource.CONNECTING) return;
      connect();
    };

    // Why the watchdog is not the reconnect timer: a connection can be open and dead — a proxy that
    // swallowed the stream, a laptop that changed networks — and nothing but missing heartbeats says so.
    watchdogRef.current = setInterval(() => {
      if (disposed || document.hidden) return;
      if (Date.now() - lastFrameAtRef.current > LIVE_IDLE_TIMEOUT_MS) scheduleReconnect();
    }, LIVE_WATCHDOG_CHECK_MS);

    document.addEventListener('visibilitychange', onVisibilityChange);
    if (!document.hidden) connect();

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearReconnect();
      closeSource();
      if (watchdogRef.current !== null) {
        clearInterval(watchdogRef.current);
        watchdogRef.current = null;
      }
      refreshRef.current = () => undefined;
    };
  }, [url]);

  const refresh = useCallback((): void => refreshRef.current(), []);

  return { status, refresh };
}
