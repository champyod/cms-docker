'use client';

import {
  DEFAULT_AMBIENT_CONFIG,
  clampMarkRevealMs,
  rollOrnament,
  type AmbientConfig,
  type AmbientOrnamentId,
} from '@/lib/contest-ambient';

interface Props {
  readonly seed: number;
  readonly isRevealing: boolean;
  readonly ambientConfig?: AmbientConfig;
}

const MARK_SIZE = 100; // viewBox unit square

/**
 * Open, flowing stroke paths for each ornament variant.
 *
 * Design rules (inspired by lottiefiles.com loading-logo-reveal and loading-icon):
 * - Every stroke is an open curve or arc — nothing ever closes into a polygon.
 * - Strokes run in and out continuously: draw-in → hold → run-out → repeat.
 * - They suggest organic motion (curves, arcs, spirals) not rigid geometry.
 * - No two strokes together form a recognisable closed shape.
 */
function markStrokes(id: AmbientOrnamentId): readonly string[] {
  if (id === 'rings') {
    // Three open arcs at different radii — gaps at opposite ends so nothing closes.
    // Outer arc: 270° (gap at bottom-right)
    // Middle arc: 270° (gap at top-left)
    // Inner arc: 270° (gap at bottom-left)
    return [
      'M50 14 A36 36 0 1 1 86 50',           // outer 270° arc, gap bottom-right
      'M50 86 A36 36 0 1 0 14 50',           // outer twin, runs opposite direction
      'M50 24 A26 26 0 1 1 76 50',           // middle 270° arc
      'M50 34 A16 16 0 1 1 66 50',           // inner 270° arc
    ];
  }

  if (id === 'spokes') {
    // A central dot + four arms that curve outward like a radar sweep — never a box.
    return [
      'M50 50 Q60 30 50 10',                  // arm curving up
      'M50 50 Q70 60 90 50',                  // arm curving right
      'M50 50 Q40 70 50 90',                  // arm curving down
      'M50 50 Q30 40 10 50',                  // arm curving left
      'M50 50 Q65 35 80 20',                  // diagonal arm ↗
    ];
  }

  if (id === 'ticks') {
    // A spiral: one continuous Bézier that winds inward — visually rich, never boxlike.
    return [
      'M88 50 C88 71 71 88 50 88',            // bottom-right quarter spiral
      'M50 88 C29 88 12 71 12 50',            // bottom-left quarter spiral
      'M12 50 C12 29 29 12 50 12',            // top-left quarter spiral
      'M50 12 C71 12 88 29 88 50',            // top-right quarter (completes near start)
      'M80 50 C80 66 66 80 50 80',            // inner ring — same open-arc treatment
      'M50 80 C34 80 20 66 20 50',
    ];
  }

  // Default: a figure-eight (∞) made of two Bézier lobes — organic, never a square.
  return [
    'M50 50 C60 20 90 20 90 50 C90 80 60 80 50 50',  // right lobe
    'M50 50 C40 20 10 20 10 50 C10 80 40 80 50 50',  // left lobe
    'M50 10 C70 10 85 28 85 50',                     // top accent arc
  ];
}

/**
 * Front-layer ornament for the ended screen.
 *
 * Animation model: each path uses the standard dash-offset draw technique
 * (`pathLength="1"`, one dash = path length, offset walks 1 → 0 → -1).
 * At offset -1 the stroke has "run out" to the right, which looks like it
 * exits the shape.  Strokes are staggered so they enter and exit in sequence,
 * creating a continuous flow rather than a flash/hold/fade cycle.
 *
 * The element itself carries no opacity animation — only the stroke offsets move.
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
        {strokes.map((d, index) => (
          <path
            key={d}
            d={d}
            // pathLength="1" normalises the dash so offset 1 = fully hidden,
            // 0 = fully drawn, -1 = stroked through and exited.
            pathLength={1}
            style={{ animationDelay: `${(index * STROKE_STAGGER_S).toFixed(2)}s` }}
          />
        ))}
      </svg>
    </div>
  );
}

/** Gap between each successive stroke starting its draw-in. */
const STROKE_STAGGER_S = 0.22;
