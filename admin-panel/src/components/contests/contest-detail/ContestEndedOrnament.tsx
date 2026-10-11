'use client';

import { DEFAULT_AMBIENT_CONFIG, clampOrnamentRotationMs, rollOrnament, type AmbientOrnamentId, type AmbientConfig } from '@/lib/contest-ambient';

interface Props {
  /** The seed the current roll came from; the ornament is drawn from it, not chosen. */
  readonly seed: number;
  /** False while the surface is paused or the reader asked for reduced motion. */
  readonly isTurning: boolean;
  /** Resolved on the server, so an operator can retune the turn without a rebuild. */
  readonly ambientConfig?: AmbientConfig;
}

/** Outer radius in the viewBox units every ornament is drawn in. */
const ORNAMENT_RADIUS = 100;

/**
 * One ornament, drawn as stroke-only geometry so it takes the roll's colour with no asset.
 * Every part is a circle, a line or a regular polygon, so nothing here resembles a letter,
 * a numeral or a diagram.
 */
function OrnamentShape({ id }: { readonly id: AmbientOrnamentId }): React.JSX.Element {
  if (id === 'rings') {
    return (
      <>
        {[0.42, 0.62, 0.82, 1].map((scale) => (
          <circle key={scale} cx="0" cy="0" r={ORNAMENT_RADIUS * scale} />
        ))}
        {[0, 90, 180, 270].map((angle) => (
          <line
            key={angle}
            x1="0"
            y1={-ORNAMENT_RADIUS * 0.42}
            x2="0"
            y2={-ORNAMENT_RADIUS}
            transform={`rotate(${angle})`}
          />
        ))}
      </>
    );
  }

  if (id === 'ticks') {
    return (
      <>
        <circle cx="0" cy="0" r={ORNAMENT_RADIUS} />
        {Array.from({ length: 48 }, (_unused, index) => {
          const angle = (index / 48) * 360;
          const isLong = index % 4 === 0;
          return (
            <line
              key={angle}
              x1="0"
              y1={-ORNAMENT_RADIUS}
              x2="0"
              y2={-ORNAMENT_RADIUS * (isLong ? 0.82 : 0.9)}
              transform={`rotate(${angle})`}
            />
          );
        })}
      </>
    );
  }

  if (id === 'spokes') {
    return (
      <>
        <circle cx="0" cy="0" r={ORNAMENT_RADIUS} />
        <circle cx="0" cy="0" r={ORNAMENT_RADIUS * 0.18} />
        {Array.from({ length: 8 }, (_unused, index) => {
          const angle = (index / 8) * 360;
          return (
            <line
              key={angle}
              x1="0"
              y1={-ORNAMENT_RADIUS * 0.18}
              x2="0"
              y2={-ORNAMENT_RADIUS}
              transform={`rotate(${angle})`}
            />
          );
        })}
      </>
    );
  }

  return (
    <>
      <circle cx="0" cy="0" r={ORNAMENT_RADIUS} />
      {[0, 1, 2].map((step) => {
        const radius = ORNAMENT_RADIUS * (0.62 - step * 0.16);
        const rotation = step * 30;
        const points = Array.from({ length: 6 }, (_unused, corner) => {
          const angle = ((corner / 6) * Math.PI * 2) + (rotation * Math.PI) / 180;
          return `${(Math.cos(angle) * radius).toFixed(2)},${(Math.sin(angle) * radius).toFixed(2)}`;
        }).join(' ');
        return <polygon key={step} points={points} />;
      })}
    </>
  );
}

/**
 * The ornament on the ended screen: one turning shape in the front layer, drawn from its own
 * set rather than the field's textures, so an ended contest reads as a different thing rather
 * than as the waiting screen with its timer removed.
 *
 * It is a transform on a constant element, so the turn is composited rather than repainted,
 * and nothing animates on its ancestor — which is what keeps it from flickering in WebKit.
 */
export function ContestEndedOrnament({
  seed,
  isTurning,
  ambientConfig = DEFAULT_AMBIENT_CONFIG,
}: Props): React.JSX.Element {
  const { ornament, palette } = rollOrnament(seed);
  const turnSeconds = clampOrnamentRotationMs(ambientConfig.ornamentRotationMs) / 1000;
  return (
    <div
      aria-hidden
      className={isTurning ? 'countdown-ornament is-turning' : 'countdown-ornament'}
      style={{
        '--countdown-hue': `${palette.glowHue}`,
        '--countdown-ornament-turn': `${turnSeconds}s`,
      } as React.CSSProperties}
    >
      <svg className="countdown-ornament-shape" viewBox="-120 -120 240 240">
        <g transform="translate(0, 0)">
          <OrnamentShape id={ornament} />
        </g>
      </svg>
    </div>
  );
}
