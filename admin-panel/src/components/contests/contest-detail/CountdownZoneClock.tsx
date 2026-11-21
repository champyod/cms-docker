'use client';

import { formatZoneClockHHMM, formatZoneTimeTitle, toZoneClockSamples } from '@/lib/contest-countdown';

const SEPARATOR = ':';

/**
 * The live wall clock in the chosen zone, HH:MM.
 *
 * Every character is its own element, so the digits are exactly as wide as the font's
 * worst-case numeral and the row cannot twitch as the minutes tick. A separator is left
 * unslotted, since a colon does not need a numeral's width.
 */
export function CountdownZoneClock({ now, timezone }: {
  readonly now: Date;
  readonly timezone: string;
}): React.JSX.Element {
  const samples = toZoneClockSamples(now, timezone);

  return (
    <div className="countdown-zone-clock">
      <div
        className="countdown-zone-clock-digits font-display font-bold"
        title={formatZoneTimeTitle(now, timezone)}
      >
        <span className="sr-only" aria-live="off">{formatZoneClockHHMM(now, timezone)}</span>
        <span className="countdown-zone-clock-glyphs" aria-hidden>
          {samples.map((glyph, index) => (
            <span
              key={index}
              className={glyph === SEPARATOR ? 'countdown-zone-clock-sep' : 'countdown-zone-clock-glyph'}
            >
              {glyph}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
