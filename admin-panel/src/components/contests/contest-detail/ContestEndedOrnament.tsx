'use client';

import {
  DEFAULT_AMBIENT_CONFIG,
  clampMarkRevealMs,
  rollOrnament,
  type AmbientConfig,
  type AmbientOrnamentId,
} from '@/lib/contest-ambient';

interface Props {
  /** Seed for selecting which ornament variant to draw. */
  readonly seed: number;
  /** False while the surface is paused or the reader asked for reduced motion. */
  readonly isRevealing: boolean;
  /** Resolved on the server so an operator can pin the mark without a rebuild. */
  readonly ambientConfig?: AmbientConfig;
}

const MARK_SIZE = 100;

/**
 * Open, non-closing strokes for each ornament variant.
 *
 * Rules:
 * - No stroke closes a full rectangle (no `Z`, and no manually closed M→H→V→H→V chain).
 * - Each stroke is a separate path so they build in sequence rather than all at once.
 * - They sweep and flow — the animation loops so they draw in, hold briefly, then reset.
 */
function markStrokes(id: AmbientOrnamentId): readonly string[] {
  if (id === 'nested') {
    // Three open concentric L-shaped arcs that spiral inward — each three sides only.
    return [
      'M20 80 L20 20 L80 20 L80 80',   // outer ∩ (top + two sides, open bottom)
      'M32 68 L32 32 L68 32 L68 68',   // middle ∩
      'M44 56 L44 44 L56 44 L56 56',   // inner ∩
    ];
  }

  if (id === 'spokes') {
    // Four sweeping diagonals / lines radiating from center — never forming a border.
    return [
      'M50 20 L50 80',                  // vertical beam
      'M20 50 L80 50',                  // horizontal beam
      'M25 25 L75 75',                  // diagonal ↘
      'M75 25 L25 75',                  // diagonal ↙
    ];
  }

  if (id === 'ticks') {
    // Seven horizontal scan lines — like a loading sweep, never a box.
    return [
      'M20 28 L80 28',
      'M20 36 L80 36',
      'M20 44 L80 44',
      'M20 52 L80 52',
      'M20 60 L80 60',
      'M20 68 L80 68',
      'M20 76 L80 76',
    ];
  }

  // Default: a single open spiral — three corners of a square, then a cross arm.
  return [
    'M80 20 L20 20 L20 80 L80 80',    // ∪ shape (three sides)
    'M20 50 L80 50',                   // horizontal arm crossing through
    'M50 20 L50 80',                   // vertical arm
  ];
}

/**
 * The front-layer ornament on the ended screen.
 *
 * Each stroke draws itself in using the standard dash-offset technique
 * (`pathLength="1"`, one dash equal to the path length, offset walked 1→0),
 * holds briefly, then resets to draw again — so the mark builds continuously
 * without ever snapping to a complete closed shape.
 *
 * Strokes are staggered so they assemble in order rather than all at once.
 */
export function ContestEndedOrnament({
  seed,
  isRevealing,
  ambientConfig = DEFAULT_AMBIENT_CONFIG,
}: Props): React.JSX.Element {
  const { ornament, palette } = rollOrnament(seed, ambientConfig.ornamentId);
  const strokes = markStrokes(ornament);
  const revealSeconds = clampMarkRevealMs(ambientConfig.markRevealMs) / 1000;

  return (
    <div
      aria-hidden
      className={isRevealing ? 'countdown-mark is-revealing' : 'countdown-mark'}
      style={{
        '--countdown-hue': `${palette.glowHue}`,
        '--countdown-mark-draw': `${revealSeconds}s`,
      } as React.CSSProperties}
    >
      <svg
        className="countdown-mark-shape"
        viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        {strokes.map((stroke, index) => (
          <path
            key={stroke}
            d={stroke}
            // pathLength="1" makes the single dash cover the whole stroke exactly,
            // so the offset can walk 1→0 without measuring the path in the browser.
            pathLength={1}
            style={{ animationDelay: `${(index * STROKE_STAGGER_SECONDS).toFixed(2)}s` }}
          />
        ))}
      </svg>
    </div>
  );
}

/** Gap between successive strokes starting; controls how fast the mark assembles. */
const STROKE_STAGGER_SECONDS = 0.18;
