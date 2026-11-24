'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

import { formatDayInZone, formatInZone, formatTimeInZone, resolveDisplayZone } from '@/lib/timezone';

/** The one reader-visible string outside the dictionary: a formatter is a function, not a component. */
export const MISSING_TIMESTAMP = 'Unknown';

/** Renders an instant, from whatever shape the payload carried it in, as text in the display zone. */
export type TimestampFormatter = (instant: string | Date) => string;

const DisplayZoneContext = createContext<string | null>(null);

interface TimezoneProviderProps {
  /** The owning contest's zone, or null where the page has no contest context. */
  readonly timezone: string | null;
  readonly children: ReactNode;
}

/** No contest leaves the provider unmounted, which makes no owner and owner-with-an-unusable-zone the same case. */
export function TimezoneProvider({ timezone, children }: TimezoneProviderProps): React.JSX.Element {
  return <DisplayZoneContext.Provider value={timezone}>{children}</DisplayZoneContext.Provider>;
}

/** Never throws: a corrupt contest row degrades to the browser zone instead of blanking the page. */
export function useDisplayTimezone(): string {
  const ownerZone = useContext(DisplayZoneContext);
  return useMemo(() => resolveDisplayZone(ownerZone), [ownerZone]);
}

/** Memoized on the zone so a list of rows reuses one formatter. */
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
