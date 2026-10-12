'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { SurfaceStatus } from '@/components/core/SurfaceState';

/** The copy a surface shows when its load never produced data. */
export interface SurfaceLoadMessages {
  readonly denied: { readonly title: string; readonly description?: string };
  readonly failed: { readonly title: string; readonly description?: string };
}

export interface SurfaceLoad<T> {
  readonly data: T | null;
  readonly status: SurfaceStatus;
  readonly reload: () => void;
}

export interface SurfaceLoadOptions {
  /**
   * Whether a refusal is read as "this account lacks the key" rather than "the call
   * failed". A server action that fails its permission gate rejects with the gate's
   * message and the surface has no typed error to switch on, so the caller decides
   * which marker means denied.
   */
  readonly isDenied?: (error: unknown) => boolean;
}

interface SurfaceLoader<T> {
  load: () => Promise<T>;
  messages: SurfaceLoadMessages;
  isDenied: (error: unknown) => boolean;
}

const DENIED_MARKER = 'Unauthorized';

/**
 * Why one hook rather than a loading flag per surface: a load that rejected left every
 * surface on its initial spinner with nothing to render, so a refused request and a slow
 * one looked the same forever. A load now ends in data, denied or failed, and the surface
 * renders a state it can act on.
 */
export function useSurfaceLoad<T>(
  load: () => Promise<T>,
  messages: SurfaceLoadMessages,
  options: SurfaceLoadOptions = {},
): SurfaceLoad<T> {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<SurfaceStatus>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef<SurfaceLoader<T>>({
    load,
    messages,
    isDenied: options.isDenied ?? isDeniedByMarker,
  });

  useEffect(() => {
    latest.current = { load, messages, isDenied: options.isDenied ?? isDeniedByMarker };
  });

  useEffect(() => {
    let active = true;
    latest.current.load().then(
      (value) => {
        if (!active) return;
        setData(value);
        setStatus({ kind: 'idle' });
      },
      (error: unknown) => {
        if (!active) return;
        const { messages: copy, isDenied } = latest.current;
        setData(null);
        setStatus({ kind: 'error', ...(isDenied(error) ? copy.denied : copy.failed) });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const reload = useCallback((): void => {
    setData(null);
    setStatus({ kind: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  return { data, status, reload };
}

function isDeniedByMarker(error: unknown): boolean {
  return error instanceof Error && error.message.includes(DENIED_MARKER);
}
