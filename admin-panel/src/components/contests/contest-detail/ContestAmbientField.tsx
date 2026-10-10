'use client';

import { useEffect, useRef } from 'react';
import { useAnimationFrame } from 'motion/react';
import { createAmbientNoise } from '@/lib/contest-ambient-noise';
import { buildAmbientField, paintAmbientField, type AmbientField } from '@/lib/contest-ambient-paint';
import { ambientDriftOffset } from '@/lib/contest-ambient-sim';
import { createAmbientRandom, type AmbientConfig, type AmbientRoll } from '@/lib/contest-ambient';

interface Props {
  readonly roll: AmbientRoll;
  readonly progress: number;
  /** Falls as the countdown nears its threshold, so the field quiets instead of racing. */
  readonly energy: number;
  readonly isAnimating: boolean;
  readonly config: AmbientConfig;
  /** Set on the field that is fading out, so a re-roll fades both ways. */
  readonly isLeaving?: boolean;
}

const FLICKER_PERIOD_SECONDS = 2.6;

/**
 * Floor on the gap between paints, so a high-refresh display cannot drive the loop
 * faster than the config allows.
 */
const MIN_FRAME_GAP_MS = 1000 / 60;

/**
 * The ambient field: a canvas of the rolled texture, drifting left to right and carried
 * along a seeded flow. Frames come from the library's frame loop rather than a
 * hand-rolled one, so the work stops when the tab is hidden and ends with the component.
 *
 * Only the drift, the flicker phase and the two simulations change per frame; the
 * texture's geometry is rebuilt only when the roll or the size does.
 */
export function ContestAmbientField({
  roll,
  progress,
  energy,
  isAnimating,
  config,
  isLeaving = false,
}: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<AmbientField | null>(null);
  const fieldSeedRef = useRef<number | null>(null);
  const sizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const elapsedRef = useRef(0);
  const lastFrameRef = useRef(0);
  const lastPaintRef = useRef(0);
  // Both are properties of the roll, so they are rebuilt whenever the seed changes.
  const noiseRef = useRef(createAmbientNoise(roll.seed));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      sizeRef.current = { width, height };
      fieldRef.current = null;
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useAnimationFrame((time: number) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    if (time - lastPaintRef.current < MIN_FRAME_GAP_MS) return;

    const deltaSeconds = lastFrameRef.current === 0 ? 0 : Math.min(0.1, (time - lastFrameRef.current) / 1000);
    lastFrameRef.current = time;
    lastPaintRef.current = time;
    if (isAnimating) elapsedRef.current += deltaSeconds;

    const bounds = sizeRef.current;
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const renderWidth = Math.round(bounds.width * pixelRatio);
    const renderHeight = Math.round(bounds.height * pixelRatio);
    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
      canvas.width = renderWidth;
      canvas.height = renderHeight;
      fieldRef.current = null;
    }

    if (!fieldRef.current || fieldSeedRef.current !== roll.seed) {
      fieldSeedRef.current = roll.seed;
      noiseRef.current = createAmbientNoise(roll.seed);
      fieldRef.current = buildAmbientField(
        roll.texture.id,
        bounds,
        roll.texture.agentCount,
        createAmbientRandom(roll.seed),
      );
    }

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    fieldRef.current = paintAmbientField(context, {
      bounds,
      palette: roll.palette,
      driftPx: ambientDriftOffset(elapsedRef.current, roll.driftSeconds, bounds.width * config.driftExtentRatio),
      progress,
      deltaSeconds: isAnimating ? deltaSeconds : 0,
      energy,
      flickerPhase: (elapsedRef.current / FLICKER_PERIOD_SECONDS) * Math.PI * 2,
      noiseAt: noiseRef.current.at,
    }, fieldRef.current);
  });

  return <canvas ref={canvasRef} aria-hidden className={isLeaving ? 'countdown-ambient is-leaving' : 'countdown-ambient'} />;
}
