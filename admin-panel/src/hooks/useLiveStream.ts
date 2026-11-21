'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { withBasePath } from '@/lib/base-path';
import { decodeLiveEnvelope, type LiveSectionReads } from '@/lib/live/frames';
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
  /**
   * Called with each frame's payload and the instant the server's read produced it. The instant is
   * what says how old the value is; a surface that shows rows stamps them with it.
   *
   * `sectionReads`, when the frame states any, dates the sections the frame carried forward from a
   * read other than the one that produced the frame. A surface whose frame accumulates several poll
   * tracks resolves each section as `sectionReads?.[section] ?? readAt`; a single-section surface
   * has none and stamps every row with `readAt`, exactly as before.
   */
  onFrame: (frame: TFrame, readAt: string, sectionReads?: LiveSectionReads) => void;
  /**
   * Called when a connection fails; the reconnect still runs. A surface whose first frame is its
   * load uses this to tell "not yet" apart from "never" — the status alone only says reconnecting.
   */
  onError?: () => void;
  /**
   * When false the channel stays closed. A surface turns this on from the state that asks for live
   * data — a viewer who may not read the stream, or a table whose auto-refresh is off.
   */
  enabled?: boolean;
  /**
   * Keeps the connection while the tab is hidden, instead of releasing it.
   *
   * Why a surface would ask for this: the pause exists so a poller does not sample for nobody, which
   * is right for everything drawn on the page — but a channel whose whole purpose is to reach an
   * operator who is not looking at the page cannot reach them by closing. The default stays off.
   */
  followHidden?: boolean;
}

export interface LiveStream {
  status: LiveStatus;
  /**
   * The instant of the newest payload the server has stated on this connection, or null while it has
   * stated none. Why it survives a drop: the data on screen is still from that read, so clearing it
   * would report the surface as dating from nowhere rather than from that instant.
   */
  readAt: string | null;
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
 * The reconnect on focus brings the panel back with a fresh snapshot. A channel that asks for
 * `followHidden` is the exception, and the one kind of channel that earns it: it exists to reach the
 * operator precisely when the tab is not on screen.
 */
export function useLiveStream<TFrame>({ url, onFrame, onError, enabled = true, followHidden = false }: UseLiveStreamOptions<TFrame>): LiveStream {
  // Why the initial state is read from the document: a tab that mounted in the background must not
  // open a connection at all, and a status set from inside the effect would be a cascading render.
  const [status, setStatus] = useState<LiveStatus>(() =>
    typeof document !== 'undefined' && document.hidden && !followHidden ? 'paused' : 'connecting'
  );
  const [readAt, setReadAt] = useState<string | null>(null);
  const onFrameRef = useRef(onFrame);
  const onErrorRef = useRef(onError);
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFrameAtRef = useRef(0);
  const attemptsRef = useRef(0);
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    onFrameRef.current = onFrame;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    if (!enabled) return;
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

      const source = new EventSource(withBasePath(url));
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
          const envelope = decodeLiveEnvelope<TFrame>(event.data as string);
          // A frame that is not an envelope is dropped as malformed rather than handed on as a
          // payload; the watchdog below still bounds the connection's lifetime.
          if (envelope === null) return;
          setReadAt(envelope.readAt);
          onFrameRef.current(envelope.frame, envelope.readAt, envelope.reads);
        } catch {
          // A malformed frame is dropped; the watchdog below still bounds the connection's lifetime.
        }
      };

      source.onerror = () => {
        if (disposed || sourceRef.current !== source) return;
        onErrorRef.current?.();
        scheduleReconnect();
      };
    };

    const onVisibilityChange = (): void => {
      if (document.hidden) {
        // Why nothing is released here: this channel's one job is to reach the operator when the tab
        // is not on screen, so a hide that closed it would make it unable to do that.
        if (followHidden) return;
        clearReconnect();
        closeSource();
        setStatus('paused');
        return;
      }
      attemptsRef.current = 0;
      clearReconnect();
      // Why a still-open source is left alone: a follow-hidden channel kept its connection through the
      // hide and its frames kept arriving, so reopening here would only replay what it already has.
      if (followHidden && sourceRef.current !== null) return;
      connect();
    };

    refreshRef.current = () => {
      attemptsRef.current = 0;
      clearReconnect();
      if (document.hidden && !followHidden) return;
      // A reconnect already in flight will deliver a fresh snapshot on its own, so a second one would
      // only add a connection without adding freshness.
      if (sourceRef.current !== null && sourceRef.current.readyState === EventSource.CONNECTING) return;
      connect();
    };

    // Why the watchdog is not the reconnect timer: a connection can be open and dead — a proxy that
    // swallowed the stream, a laptop that changed networks — and nothing but missing heartbeats says so.
    // Why it keeps running for a follow-hidden channel: a dead connection there is a silently missed
    // alert, so the one check that notices it cannot be the check the hide switches off.
    watchdogRef.current = setInterval(() => {
      if (disposed || (document.hidden && !followHidden)) return;
      if (Date.now() - lastFrameAtRef.current > LIVE_IDLE_TIMEOUT_MS) scheduleReconnect();
    }, LIVE_WATCHDOG_CHECK_MS);

    document.addEventListener('visibilitychange', onVisibilityChange);
    if (!document.hidden || followHidden) connect();

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
  }, [url, enabled, followHidden]);

  const refresh = useCallback((): void => refreshRef.current(), []);

  // Why the status is derived here: a disabled channel has no connection state of its own, and the
  // pause is the surface's own choice, not something the stream discovered. The read instant is
  // dropped with it: a channel the surface turned off has stated nothing about the data on screen.
  return { status: enabled ? status : 'paused', readAt: enabled ? readAt : null, refresh };
}
