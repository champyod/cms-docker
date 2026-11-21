'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

import { formatDayInZone, formatInZone, formatTimeInZone, resolveDisplayZone } from '@/lib/timezone';

/**
 * The glyph every formatter here falls back to: a payload that carries no parseable instant gets
 * one fixed character rather than a blank cell or the browser's "Invalid Date" text, so a row's
 * absence is visible and identical across surfaces.
 */
export const MISSING_TIMESTAMP = '—';

/** Renders an instant, from whatever shape the payload carried it in, as text in the display zone. */
export type TimestampFormatter = (instant: string | Date) => string;

const DisplayZoneContext = createContext<string | null>(null);

interface TimezoneProviderProps {
  /** The owning contest's zone, or null where the page has no contest context. */
  readonly timezone: string | null;
  readonly children: ReactNode;
}

/**
 * Publishes the zone of the contest that owns the record being rendered, so one page's timestamps
 * cannot disagree with each other. A route that mounts this owns every timestamp below it; a route
 * with no contest leaves it unmounted rather than seeding it, which is what makes "no owner" and
 * "owner with an unusable zone string" the same case at the hook boundary.
 */
export function TimezoneProvider({ timezone, children }: TimezoneProviderProps): React.JSX.Element {
  return <DisplayZoneContext.Provider value={timezone}>{children}</DisplayZoneContext.Provider>;
}

/**
 * The zone timestamps under this point are displayed in: the owning contest's zone, or the runtime's
 * own zone where no provider is mounted. Never throws, so a corrupt contest row degrades to the
 * browser zone instead of blanking the page.
 */
export function useDisplayTimezone(): string {
  const ownerZone = useContext(DisplayZoneContext);
  return useMemo(() => resolveDisplayZone(ownerZone), [ownerZone]);
}

/**
 * A formatter for `render` bound to the current display zone, memoized on the zone so a list of rows
 * reuses one formatter. Input that is not a parseable instant renders `MISSING_TIMESTAMP`.
 */
function useInstantFormatter(render: (iso: string, zone: string) => string): TimestampFormatter {
  const zone = useDisplayTimezone();
  return useCallback(
    (instant: string | Date): string => {
      const parsed = new Date(instant);
      return Number.isNaN(parsed.getTime()) ? MISSING_TIMESTAMP : render(parsed.toISOString(), zone);
    },
    [render, zone],
  );
}

/** A `dd/mm/yyyy, HH:MM:SS` formatter for the display zone; `MISSING_TIMESTAMP` for an unusable instant. */
export function useFormatTimestamp(): TimestampFormatter {
  return useInstantFormatter(formatInZone);
}

/** A `dd/mm/yyyy` formatter for the display zone, for columns that mean a day and nothing finer. */
export function useFormatDay(): TimestampFormatter {
  return useInstantFormatter(formatDayInZone);
}

/** An `HH:MM` formatter for the display zone, for surfaces that name the day themselves. */
export function useFormatTimeOfDay(): TimestampFormatter {
  return useInstantFormatter(formatTimeInZone);
}
