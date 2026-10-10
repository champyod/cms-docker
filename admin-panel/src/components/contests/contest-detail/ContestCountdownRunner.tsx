'use client';

import { useEffect, useRef, useState } from 'react';
import { resolveRunnerStrideSeconds } from '@/lib/contest-countdown';
import { RUNNER_SHAPE_ROTATION_MS, shapeForTurn } from '@/lib/contest-countdown-runner';
import { ContestCountdownShape } from './ContestCountdownShape';

type Edge = 'top' | 'right' | 'bottom' | 'left';

const EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];

interface Point {
  x: number;
  y: number;
}

interface Props {
  readonly speedPxPerSecond: number;
}

function randomEdge(): Edge {
  return EDGES[Math.floor(Math.random() * EDGES.length)];
}

function randomOtherEdge(edge: Edge): Edge {
  const others = EDGES.filter((candidate) => candidate !== edge);
  return others[Math.floor(Math.random() * others.length)];
}

function randomEdgePoint(edge: Edge, width: number, height: number): Point {
  const along = Math.random();
  if (edge === 'top') return { x: along * width, y: 0 };
  if (edge === 'bottom') return { x: along * width, y: height };
  if (edge === 'left') return { x: 0, y: along * height };
  return { x: width, y: along * height };
}

/** Mirrored to face the way it travels; CSS centres the figure on its point. */
function place(figure: HTMLDivElement, point: Point, deltaX: number): void {
  figure.style.transform = `translate3d(${point.x}px, ${point.y}px, 0) scaleX(${deltaX < 0 ? -1 : 1})`;
}

/**
 * A figure that runs from a random edge to a random edge, for as long as
 * something counts down, changing its shape on a timer. Distance is covered per
 * frame from the current pace, so a change of speed is felt mid-leg rather than
 * at the next leg boundary.
 */
export function ContestCountdownRunner({ speedPxPerSecond }: Props): React.JSX.Element {
  const fieldRef = useRef<HTMLDivElement>(null);
  const figureRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef(speedPxPerSecond);
  const [turn, setTurn] = useState(0);

  // The figure changes on a timer, so a long wait is not spent watching one shape.
  useEffect(() => {
    const interval = window.setInterval(() => setTurn((current) => current + 1), RUNNER_SHAPE_ROTATION_MS);
    return () => window.clearInterval(interval);
  }, []);

  // The beat quickens with the pace; once a second is all the countdown can change it.
  useEffect(() => {
    speedRef.current = speedPxPerSecond;
    figureRef.current?.style.setProperty('--countdown-beat', `${resolveRunnerStrideSeconds(speedPxPerSecond)}s`);
  }, [speedPxPerSecond]);

  useEffect(() => {
    const field = fieldRef.current;
    const figure = figureRef.current;
    if (!field || !figure) return;

    let frame = 0;
    let lastTime = 0;
    let edge = randomEdge();
    let current = randomEdgePoint(edge, field.clientWidth, field.clientHeight);
    let target = current;
    place(figure, current, 0);

    const tick = (time: number): void => {
      // A background tab pauses rAF, so clamp the return instead of teleporting the runner.
      const deltaSeconds = lastTime === 0 ? 0 : Math.min(0.1, (time - lastTime) / 1000);
      lastTime = time;
      const width = field.clientWidth;
      const height = field.clientHeight;
      if (width > 0 && height > 0) {
        const distance = Math.hypot(target.x - current.x, target.y - current.y);
        const step = speedRef.current * deltaSeconds;
        if (distance <= step) {
          current = target;
          edge = randomOtherEdge(edge);
          target = randomEdgePoint(edge, width, height);
        } else {
          const ratio = step / distance;
          current = {
            x: current.x + (target.x - current.x) * ratio,
            y: current.y + (target.y - current.y) * ratio,
          };
        }
        place(figure, current, target.x - current.x);
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div ref={fieldRef} aria-hidden className="countdown-runner-field">
      <div ref={figureRef} className="countdown-runner">
        <ContestCountdownShape id={shapeForTurn(turn)} />
      </div>
    </div>
  );
}
