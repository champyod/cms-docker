'use client';

import {
  DEFAULT_AMBIENT_CONFIG,
  clampMarkRevealMs,
  rollOrnament,
  type AmbientConfig,
} from '@/lib/contest-ambient';

interface Props {
  readonly seed: number;
  readonly isRevealing: boolean;
  readonly ambientConfig?: AmbientConfig;
}

const MARK_SIZE = 100; // viewBox unit square
const MARK_CENTRE = MARK_SIZE / 2;
const BALL_RADIUS = 7;
const BALL_TRAVEL = 28;

interface MarkBall {
  readonly cx: number;
  readonly cy: number;
  /** The one vector that carries this ball from its arm to the middle. */
  readonly shiftX: number;
  readonly shiftY: number;
}

const MARK_BALLS: readonly MarkBall[] = [
  { cx: MARK_CENTRE, cy: MARK_CENTRE - BALL_TRAVEL, shiftX: 0, shiftY: BALL_TRAVEL },
  { cx: MARK_CENTRE + BALL_TRAVEL, cy: MARK_CENTRE, shiftX: -BALL_TRAVEL, shiftY: 0 },
  { cx: MARK_CENTRE, cy: MARK_CENTRE + BALL_TRAVEL, shiftX: 0, shiftY: -BALL_TRAVEL },
  { cx: MARK_CENTRE - BALL_TRAVEL, cy: MARK_CENTRE, shiftX: BALL_TRAVEL, shiftY: 0 },
];

/**
 * Front-layer ornament for the ended screen.
 *
 * Four balls on the cross's arms, each carrying its own vector to the middle. Every ball runs
 * the same four quarters of a cycle and starts one quarter after the ball before it, so the
 * balls meet in the middle in sequence and hand over to the next one. Only the translate moves:
 * the shape of a ball never changes, and nothing on an ancestor of the blurred surface animates.
 */
export function ContestEndedOrnament({
  seed,
  isRevealing,
  ambientConfig = DEFAULT_AMBIENT_CONFIG,
}: Props): React.JSX.Element {
  const { palette } = rollOrnament(seed, ambientConfig.ornamentId);
  const cycleSeconds = clampMarkRevealMs(ambientConfig.markRevealMs) / 1000;

  return (
    <div
      aria-hidden
      className={isRevealing ? 'countdown-mark is-revealing' : 'countdown-mark'}
      style={{
        '--countdown-hue': `${palette.glowHue}`,
        '--countdown-mark-cycle': `${cycleSeconds}s`,
      } as React.CSSProperties}
    >
      <svg
        className="countdown-mark-shape"
        viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        {MARK_BALLS.map((ball, index) => (
          <circle
            key={`${ball.cx}-${ball.cy}`}
            cx={ball.cx}
            cy={ball.cy}
            r={BALL_RADIUS}
            style={{
              '--countdown-ball-x': `${ball.shiftX}px`,
              '--countdown-ball-y': `${ball.shiftY}px`,
              animationDelay: `${((index * cycleSeconds) / MARK_BALLS.length).toFixed(3)}s`,
            } as React.CSSProperties}
          />
        ))}
      </svg>
    </div>
  );
}
