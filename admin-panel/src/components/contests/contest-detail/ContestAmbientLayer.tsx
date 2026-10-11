'use client';

import { useEffect, useRef, useState } from 'react';
import { ContestAmbientField } from './ContestAmbientField';
import { useContestAmbient } from './useContestAmbient';
import { DEFAULT_AMBIENT_CONFIG, type AmbientConfig, type AmbientRoll } from '@/lib/contest-ambient';

interface Props {
  /** False in the running phase, where only the panic applies. */
  readonly isIdle: boolean;
  readonly isPaused: boolean;
  readonly nowMs: number;
  readonly thresholdMs: number | null;
  /** Changes when the surface's state changes, which triggers a fresh roll. */
  readonly rerollKey: string;
  /** Resolved on the server from config.toml, so an operator can retune without a rebuild. */
  readonly ambientConfig?: AmbientConfig;
}

/** Must match the field's own fade, so the outgoing field is unmounted when invisible. */
const HANDOVER_MS = 900;

/** The outgoing field keeps a little less energy than the live one, so the swap reads as a fade. */
const OUTGOING_ENERGY = 0.6;

/**
 * The ambient layer: the rolled field, the fade in, the 20% blur steps and the timer's
 * background.
 *
 * While a roll changes, the outgoing field stays mounted under the incoming one so it
 * fades out rather than being cut. Both are inert to pointers and hidden from the
 * accessibility tree, since the field is decoration.
 */
export function ContestAmbientLayer({
  isIdle,
  isPaused,
  nowMs,
  thresholdMs,
  rerollKey,
  ambientConfig = DEFAULT_AMBIENT_CONFIG,
}: Props): React.JSX.Element | null {
  const { roll, progress, blurPx, isFullyBlurred, isAnimating, isRolled } = useContestAmbient({
    thresholdMs,
    nowMs,
    isPaused,
    rerollKey,
    config: ambientConfig,
  });
  const [outgoing, setOutgoing] = useState<AmbientRoll | null>(null);
  const previousRef = useRef<AmbientRoll | null>(null);

  // Hand the previous roll over to the fade-out slot when the seed changes, then release it.
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = roll;
    if (!previous || previous.seed === roll.seed) return;
    setOutgoing(previous);
    const timeout = window.setTimeout(() => setOutgoing(null), HANDOVER_MS);
    return () => window.clearTimeout(timeout);
  }, [roll]);

  if (!isIdle || !isRolled) return null;

  const layerStyle = {
    '--countdown-ambient-blur': `${blurPx}px`,
    '--countdown-hue': `${roll.palette.glowHue}`,
  } as React.CSSProperties;

  return (
    <div aria-hidden className="countdown-ambient-layer" style={layerStyle}>
      {outgoing ? (
        <ContestAmbientField
          key={`out-${outgoing.seed}`}
          roll={outgoing}
          progress={progress}
          energy={OUTGOING_ENERGY}
          isAnimating={false}
          config={ambientConfig}
          isLeaving
        />
      ) : null}
      <ContestAmbientField
        key={`in-${roll.seed}`}
        roll={roll}
        progress={progress}
        energy={1 - progress * 0.35}
        isAnimating={isAnimating}
        config={ambientConfig}
      />
      <div className={isFullyBlurred ? 'countdown-timer-bed is-shown' : 'countdown-timer-bed'}>
        <span className="countdown-timer-bed-surface" />
      </div>
    </div>
  );
}
