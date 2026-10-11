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

/** The live field runs at full energy; the ramp is carried by density, not by pace. */
const AMBIENT_LIVE_ENERGY = 1;

/**
 * The ambient layer: the rolled field, the fade in, the 20% ramp and the timer's
 * background.
 *
 * Nothing here blurs and nothing is drawn behind the digits. The sense of approach is
 * carried by the field's objects growing and by the drift sweep, which is a transform on
 * this layer so both stacked fields move together as one object.
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
  const { roll, progress, density, itemScale, isAnimating, isRolled } = useContestAmbient({
    thresholdMs,
    nowMs,
    isPaused,
    rerollKey,
    config: ambientConfig,
  });
  const [outgoing, setOutgoing] = useState<AmbientRoll | null>(null);
  const [driftPx, setDriftPx] = useState(0);
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
    '--countdown-hue': `${roll.palette.glowHue}`,
    // The sweep the field drifts on. Transform only, so it never leaves the compositor.
    '--countdown-ambient-drift': `${driftPx.toFixed(2)}px`,
  } as React.CSSProperties;

  return (
    <div aria-hidden className="countdown-ambient-layer" style={layerStyle}>
      {outgoing ? (
        <ContestAmbientField
          key={`out-${outgoing.seed}`}
          roll={outgoing}
          progress={progress}
          density={density}
          itemScale={itemScale}
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
        density={density}
        itemScale={itemScale}
        energy={AMBIENT_LIVE_ENERGY}
        isAnimating={isAnimating}
        config={ambientConfig}
        onDrift={setDriftPx}
      />
    </div>
  );
}
