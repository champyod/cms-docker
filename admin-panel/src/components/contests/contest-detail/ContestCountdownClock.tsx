'use client';

import { panicDigitClassNames, panicDigitStyle } from '@/lib/contest-panic';

// ── Time decomposition ────────────────────────────────────────────────────────

interface TimeUnits {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Break a millisecond duration into whole days / hours / minutes / seconds. */
function decompose(totalMs: number): TimeUnits {
  const total = Math.max(0, Math.floor(totalMs / 1000));
  return {
    days:    Math.floor(total / 86400),
    hours:   Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** Left-pad a single number to two digits. */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// ── Single animated digit ─────────────────────────────────────────────────────

interface DigitProps {
  char: string;
  /** Absolute position in the display row — used to stagger panic motion. */
  index: number;
  isPanicking: boolean;
  panicTurn: number;
}

/**
 * One character.  Re-mounts (and plays the entry animation) whenever its value
 * changes.  Key encodes both position and character so only changed digits fire.
 */
function Digit({ char, index, isPanicking, panicTurn }: DigitProps): React.JSX.Element {
  return (
    <span
      className="yt-digit"
      style={panicDigitStyle(isPanicking, index, panicTurn) as React.CSSProperties | undefined}
    >
      <span className={['countdown-panic-move', ...panicDigitClassNames(isPanicking)].join(' ')}>
        {char}
      </span>
    </span>
  );
}

// ── One time-unit card  ───────────────────────────────────────────────────────

interface UnitBlockProps {
  value: string;      // always two characters, e.g. "07"
  label: string;
  startIndex: number; // first digit's global position, for panic stagger
  isPanicking: boolean;
  panicTurn: number;
}

function UnitBlock({ value, label, startIndex, isPanicking, panicTurn }: UnitBlockProps): React.JSX.Element {
  return (
    <div className="yt-unit-block">
      <div className="yt-unit-digits font-display font-bold leading-none">
        {[...value].map((char, offset) => (
          <Digit
            key={`${startIndex + offset}:${char}`}
            char={char}
            index={startIndex + offset}
            isPanicking={isPanicking}
            panicTurn={panicTurn}
          />
        ))}
      </div>
      <span className="yt-unit-label">{label}</span>
    </div>
  );
}

// ── Colon separator ───────────────────────────────────────────────────────────

/** Vertically-centred separator that blinks once per second. */
function Separator(): React.JSX.Element {
  return <span className="yt-sep" aria-hidden>:</span>;
}

// ── Public component ──────────────────────────────────────────────────────────

interface Props {
  /** Milliseconds remaining; `null` means no target time is configured. */
  readonly remainingMs: number | null;
  /** Panic mode: every digit shakes independently at the hurry threshold. */
  readonly isPanicking?: boolean;
  /** Increments each panic cycle so digits get fresh motion. */
  readonly panicTurn?: number;
}

// Fixed digit positions so panic stagger is stable regardless of which units are visible.
const IDX_DAYS    = 0;
const IDX_HOURS   = 2;
const IDX_MINUTES = 4;
const IDX_SECONDS = 6;

/**
 * Left-prune zero leading units.
 *
 * Rules (applied in order from most significant to least):
 *  - Days are shown only when days > 0.
 *  - Hours are shown only when days > 0 OR hours > 0.
 *  - Minutes and seconds are always shown (the minimum display is MM:SS).
 *
 * This means:
 *   3d 04h 05m 06s → 03:04:05:06
 *      04h 05m 06s →    04:05:06
 *          05m 06s →       05:06
 *              06s →       00:06  ← seconds always shown with MM floor
 */
function visibleUnits(units: TimeUnits): {
  showDays: boolean;
  showHours: boolean;
} {
  const showDays = units.days > 0;
  const showHours = showDays || units.hours > 0;
  return { showDays, showHours };
}

/**
 * YouTube Premiere-style countdown: DAYS · HOURS · MINUTES · SECONDS.
 *
 * Leading zero units are pruned from the left so the display is always
 * as compact as the current time requires.  Minutes and seconds are the
 * minimum — the display never shrinks below MM:SS.
 *
 * All three original props are preserved unchanged.
 */
export function ContestCountdownClock({
  remainingMs,
  isPanicking = false,
  panicTurn = 0,
}: Props): React.JSX.Element {
  const units = remainingMs !== null ? decompose(remainingMs) : null;
  const { showDays, showHours } = units !== null
    ? visibleUnits(units)
    : { showDays: false, showHours: false };

  return (
    <div className="yt-clock-shell">
      {units === null ? (
        /* Ended / unconfigured — invisible placeholder keeps the layout intact. */
        <div className="yt-clock-placeholder" aria-hidden />
      ) : (
        <div className="yt-units-row">
          {showDays && (
            <>
              <UnitBlock value={pad2(units.days)} label="DAYS"
                startIndex={IDX_DAYS} isPanicking={isPanicking} panicTurn={panicTurn} />
              <Separator />
            </>
          )}
          {showHours && (
            <>
              <UnitBlock value={pad2(units.hours)} label="HOURS"
                startIndex={IDX_HOURS} isPanicking={isPanicking} panicTurn={panicTurn} />
              <Separator />
            </>
          )}
          <UnitBlock value={pad2(units.minutes)} label="MINUTES"
            startIndex={IDX_MINUTES} isPanicking={isPanicking} panicTurn={panicTurn} />
          <Separator />
          <UnitBlock value={pad2(units.seconds)} label="SECONDS"
            startIndex={IDX_SECONDS} isPanicking={isPanicking} panicTurn={panicTurn} />
        </div>
      )}
    </div>
  );
}
