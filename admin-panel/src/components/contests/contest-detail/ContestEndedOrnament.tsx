'use client';

import {
  DEFAULT_AMBIENT_CONFIG,
  clampMarkRevealMs,
  rollOrnament,
  type AmbientConfig,
  type AmbientOrnamentId,
} from '@/lib/contest-ambient';

interface Props {
  /** The seed the current roll came from; the mark is drawn from it, not chosen. */
  readonly seed: number;
  /** False while the surface is paused or the reader asked for reduced motion. */
  readonly isRevealing: boolean;
  /** Resolved on the server, so an operator can pin the mark without a rebuild. */
  readonly ambientConfig?: AmbientConfig;
}

/** The mark is drawn in a 100-unit box, so every coordinate below is a share of it. */
const MARK_SIZE = 100;

/**
 * The mark's outline, as an ordered list of strokes.
 *
 * WHY ordered and separate: the reveal draws each stroke in turn, so the mark assembles
 * rather than appearing at once. A single path would let the dash walk the whole shape in one
 * sweep, which reads as a loader rather than as something being built.
 */
function markStrokes(id: AmbientOrnamentId): readonly string[] {
  if (id === 'nested') {
    return [
      'M20 20 H80 V80 H20 Z',
      'M32 32 H68 V68 H32 Z',
      'M44 44 H56 V56 H44 Z',
    ];
  }

  if (id === 'spokes') {
    return [
      'M20 20 H80 V80 H20 Z',
      'M20 50 H80',
      'M50 20 V80',
      'M20 20 L80 80',
    ];
  }

  if (id === 'ticks') {
    return [
      'M20 20 H80 V80 H20 Z',
      'M20 28 H80',
      'M20 36 H80',
      'M20 44 H80',
      'M20 52 H80',
      'M20 60 H80',
      'M20 68 H80',
      'M20 76 H80',
    ];
  }

  return [
    'M20 20 H80 V80 H20 Z',
    'M20 50 H80',
    'M50 20 V80',
  ];
}

/**
 * The front-layer mark: an outline on a square that draws itself on, stroke by stroke, then
 * resets and draws again.
 *
 * A reveal rather than a turn: the reference this follows — LottieFiles' loading logo reveal —
 * is an idle opener that assembles its mark, and a rotating graphic is a different verb. The
 * draw is the classic dash technique, one dash equal to the path's own length walked from
 * full offset to zero, so nothing here is a keyframe per stroke.
 *
 * It is drawn on one element with a constant geometry, so the animation is a stroke offset
 * and nothing on it or its ancestors changes size — which is what keeps it from flickering in
 * WebKit and from nudging the layout it sits over.
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
            // Every stroke is a single continuous path, so one dash covers it exactly and the
            // offset can be walked from 1 to 0 without measuring anything in the browser.
            pathLength={1}
            style={{
              // Staggered so the mark assembles in order instead of every stroke at once.
              animationDelay: `${(index * STROKE_STAGGER_SECONDS).toFixed(2)}s`,
            }}
          />
        ))}
      </svg>
    </div>
  );
}

/** Gap between one stroke starting and the next; with the draw time it sets the whole cycle. */
const STROKE_STAGGER_SECONDS = 0.18;
