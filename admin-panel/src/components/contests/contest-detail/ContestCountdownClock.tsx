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
    minutes: Math.floor((total % 3600)  / 60),
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
 * One character that re-mounts (and plays its entry animation) whenever its
 * value changes.  The `key` on the parent element encodes both position and
 * character, so only the digit that actually changed triggers a new mount.
 */
function Digit({ char, index, isPanicking, panicTurn }: DigitProps): React.JSX.Element {
  return (
    <span
      className="countdown-digit is-slot"
      style={panicDigitStyle(isPanicking, index, panicTurn) as React.CSSProperties | undefined}
    >
      <span className={['countdown-panic-move', ...panicDigitClassNames(isPanicking)].join(' ')}>
        {char}
      </span>
    </span>
  );
}

// ── One time-unit card (e.g. "07 MINUTES") ───────────────────────────────────

interface UnitBlockProps {
  /** Two-character padded string, e.g. "07". */
  value: string;
  label: string;
  /** Index of the first digit in this block within the global sequence. */
  startIndex: number;
  isPanicking: boolean;
  panicTurn: number;
}

function UnitBlock({
  value,
  label,
  startIndex,
  isPanicking,
  panicTurn,
}: UnitBlockProps): React.JSX.Element {
  return (
    <div className="yt-unit-block">
      {/* Digits */}
      <div className="yt-unit-digits font-display font-bold leading-none tracking-tight">
        {[...value].map((char, offset) => (
          // Key encodes position + char so only a changed digit re-mounts.
          <Digit
            key={`${startIndex + offset}:${char}`}
            char={char}
            index={startIndex + offset}
            isPanicking={isPanicking}
            panicTurn={panicTurn}
          />
        ))}
      </div>

      {/* Unit label */}
      <span className="yt-unit-label">{label}</span>
    </div>
  );
}

// ── Colon separator ───────────────────────────────────────────────────────────

/** Visual separator between unit blocks; pulses to signal each tick. */
function Separator(): React.JSX.Element {
  return (
    <span className="yt-unit-sep" aria-hidden>
      :
    </span>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

interface Props {
  /** Milliseconds remaining; `null` means no target time is configured. */
  readonly remainingMs: number | null;
  /** Panic mode: every digit shakes independently at the hurry threshold. */
  readonly isPanicking?: boolean;
  /** Increments each panic-animation cycle so each digit gets a fresh motion. */
  readonly panicTurn?: number;
}

// Digit index offsets per unit — fixed positions so panic stagger is stable.
const IDX_DAYS    = 0; // digits 0-1
const IDX_HOURS   = 2; // digits 2-3
const IDX_MINUTES = 4; // digits 4-5
const IDX_SECONDS = 6; // digits 6-7

/**
 * YouTube Premiere-style countdown clock.
 *
 * Displays days, hours, minutes, and seconds each in a labeled card that
 * updates every second.  Days are hidden when the remaining time is under
 * 24 hours to avoid a leading "00 DAYS" card.
 *
 * All existing props are preserved: `remainingMs`, `isPanicking`, `panicTurn`.
 * The resize-observer font-scaling logic from the previous string-based renderer
 * is replaced by a fluid `clamp()` in CSS, which is sufficient for labeled units.
 */
export function ContestCountdownClock({
  remainingMs,
  isPanicking = false,
  panicTurn = 0,
}: Props): React.JSX.Element {
  const units = remainingMs !== null ? decompose(remainingMs) : null;
  const showDays = units !== null && units.days > 0;

  return (
    <div className="countdown-shell flex min-h-0 flex-1 flex-col">
      <div className="countdown-box yt-countdown-row flex min-h-[200px] w-full flex-1 items-center justify-center overflow-hidden">
        {units === null ? (
          // No timing configured — render a static em-dash placeholder.
          <span
            className="font-display font-bold text-muted-foreground"
            style={{ fontSize: 'clamp(2rem, 8vmin, 6rem)' }}
          >
            —
          </span>
        ) : (
          <div className="yt-units-row">
            {showDays && (
              <>
                <UnitBlock
                  value={pad2(units.days)}
                  label="DAYS"
                  startIndex={IDX_DAYS}
                  isPanicking={isPanicking}
                  panicTurn={panicTurn}
                />
                <Separator />
              </>
            )}

            <UnitBlock
              value={pad2(units.hours)}
              label="HOURS"
              startIndex={IDX_HOURS}
              isPanicking={isPanicking}
              panicTurn={panicTurn}
            />
            <Separator />

            <UnitBlock
              value={pad2(units.minutes)}
              label="MINUTES"
              startIndex={IDX_MINUTES}
              isPanicking={isPanicking}
              panicTurn={panicTurn}
            />
            <Separator />

            <UnitBlock
              value={pad2(units.seconds)}
              label="SECONDS"
              startIndex={IDX_SECONDS}
              isPanicking={isPanicking}
              panicTurn={panicTurn}
            />
          </div>
        )}
      </div>
    </div>
  );
}
