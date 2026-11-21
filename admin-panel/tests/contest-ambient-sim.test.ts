import { describe, expect, it } from 'vitest';

import { createAmbientNoise } from '@/lib/contest-ambient-noise';
import {
  AMBIENT_BOID_MAX_SPEED_PX_PER_SECOND,
  AMBIENT_FLOW_SPEED_PX_PER_SECOND,
  ambientDriftOffset,
  buildAmbientFlock,
  buildAmbientParticles,
  stepAmbientFlock,
  stepAmbientFlow,
  wrapCoordinate,
  type AmbientAgent,
  type AmbientBounds,
} from '@/lib/contest-ambient-sim';
import { createAmbientRandom } from '@/lib/contest-ambient';

const BOUNDS: AmbientBounds = { width: 800, height: 600 };
const NOISE = createAmbientNoise(0.37).at;
const FIELD_PARAMS = { driftX: 0, energy: 1 };

function seededFlock(count: number): readonly AmbientAgent[] {
  return buildAmbientFlock(count, BOUNDS, createAmbientRandom(0.5));
}

describe('wrapCoordinate', () => {
  it('folds a value back inside its extent', () => {
    expect(wrapCoordinate(950, 800)).toBe(150);
    expect(wrapCoordinate(-50, 800)).toBe(750);
  });

  it('keeps a value already inside untouched', () => {
    expect(wrapCoordinate(123, 800)).toBe(123);
  });

  it('never returns the extent itself, so nothing lands on the seam', () => {
    expect(wrapCoordinate(800, 800)).toBe(0);
    expect(wrapCoordinate(1600, 800)).toBe(0);
  });

  it('returns zero for a degenerate extent or a non-finite value', () => {
    expect(wrapCoordinate(10, 0)).toBe(0);
    expect(wrapCoordinate(Number.NaN, 800)).toBe(0);
  });
});

describe('ambientDriftOffset', () => {
  it('starts at the centre', () => {
    expect(ambientDriftOffset(0, 10, 40)).toBe(0);
  });

  it('sweeps both ways over one period', () => {
    const right = ambientDriftOffset(2.5, 10, 40);
    const left = ambientDriftOffset(7.5, 10, 40);
    expect(right).toBeGreaterThan(0);
    expect(left).toBeLessThan(0);
  });

  it('stays inside the extent it is given', () => {
    for (let second = 0; second < 40; second += 0.13) {
      expect(Math.abs(ambientDriftOffset(second, 9, 40))).toBeLessThanOrEqual(40);
    }
  });

  it('does not move at all without a period', () => {
    expect(ambientDriftOffset(5, 0, 40)).toBe(0);
  });
});

describe('stepAmbientFlow', () => {
  it('keeps a particle inside its bounds however long it runs', () => {
    let point = { x: 10, y: 10 };
    for (let step = 0; step < 3_000; step += 1) {
      point = stepAmbientFlow(point, NOISE, FIELD_PARAMS, 0.05, BOUNDS);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThan(BOUNDS.width);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThan(BOUNDS.height);
    }
  });

  it('moves no further in one step than the pace allows', () => {
    const start = { x: 400, y: 300 };
    const next = stepAmbientFlow(start, NOISE, FIELD_PARAMS, 0.1, BOUNDS);
    expect(Math.hypot(next.x - start.x, next.y - start.y))
      .toBeLessThanOrEqual(AMBIENT_FLOW_SPEED_PX_PER_SECOND * 0.1 + 1e-6);
  });

  it('stands still when the energy is spent', () => {
    const start = { x: 400, y: 300 };
    const next = stepAmbientFlow(start, NOISE, { driftX: 0, energy: 0 }, 0.1, BOUNDS);
    expect(next).toStrictEqual(start);
  });

  it('is deterministic from the seed through the same noise', () => {
    const start = { x: 120, y: 240 };
    expect(stepAmbientFlow(start, NOISE, FIELD_PARAMS, 0.05, BOUNDS))
      .toStrictEqual(stepAmbientFlow(start, NOISE, FIELD_PARAMS, 0.05, BOUNDS));
  });
});

describe('buildAmbientParticles', () => {
  it('starts every particle inside the field', () => {
    for (const particle of buildAmbientParticles(60, BOUNDS, createAmbientRandom(0.9))) {
      expect(particle.x).toBeGreaterThanOrEqual(0);
      expect(particle.x).toBeLessThanOrEqual(BOUNDS.width);
      expect(particle.y).toBeGreaterThanOrEqual(0);
      expect(particle.y).toBeLessThanOrEqual(BOUNDS.height);
    }
  });

  it('scatters rather than clustering on one point', () => {
    const particles = buildAmbientParticles(60, BOUNDS, createAmbientRandom(0.2));
    expect(new Set(particles.map((particle) => Math.round(particle.x))).size).toBeGreaterThan(20);
  });
});

describe('stepAmbientFlock', () => {
  it('keeps every agent inside the field over a long run', () => {
    let flock = seededFlock(40);
    for (let step = 0; step < 600; step += 1) {
      flock = stepAmbientFlock(flock, NOISE, FIELD_PARAMS, 1 / 30, BOUNDS);
    }
    for (const agent of flock) {
      expect(agent.x).toBeGreaterThanOrEqual(0);
      expect(agent.x).toBeLessThan(BOUNDS.width);
      expect(agent.y).toBeGreaterThanOrEqual(0);
      expect(agent.y).toBeLessThan(BOUNDS.height);
    }
  });

  it('holds every agent to the pace the energy allows', () => {
    let flock = seededFlock(40);
    for (let step = 0; step < 300; step += 1) {
      flock = stepAmbientFlock(flock, NOISE, FIELD_PARAMS, 1 / 30, BOUNDS);
      for (const agent of flock) {
        const speed = Math.hypot(agent.velocityX, agent.velocityY);
        expect(speed).toBeLessThanOrEqual(AMBIENT_BOID_MAX_SPEED_PX_PER_SECOND + 1e-6);
      }
    }
  });

  it('settles as the energy falls, rather than holding full speed', () => {
    let flock = seededFlock(30);
    for (let step = 0; step < 200; step += 1) {
      flock = stepAmbientFlock(flock, NOISE, { driftX: 0, energy: 0.25 }, 1 / 30, BOUNDS);
    }
    const fastest = Math.max(...flock.map((agent) => Math.hypot(agent.velocityX, agent.velocityY)));
    expect(fastest).toBeLessThanOrEqual(AMBIENT_BOID_MAX_SPEED_PX_PER_SECOND * 0.25 + 1e-6);
  });

  it('returns one agent per agent, in order', () => {
    const flock = seededFlock(25);
    expect(stepAmbientFlock(flock, NOISE, FIELD_PARAMS, 1 / 30, BOUNDS)).toHaveLength(flock.length);
  });

  it('is deterministic from the seed', () => {
    const first = stepAmbientFlock(seededFlock(20), NOISE, FIELD_PARAMS, 1 / 30, BOUNDS);
    const second = stepAmbientFlock(seededFlock(20), NOISE, FIELD_PARAMS, 1 / 30, BOUNDS);
    expect(first).toStrictEqual(second);
  });

  it('does not divide by zero when two agents share a position', () => {
    const stacked: readonly AmbientAgent[] = [
      { x: 400, y: 300, velocityX: 0, velocityY: 0 },
      { x: 400, y: 300, velocityX: 0, velocityY: 0 },
    ];
    const next = stepAmbientFlock(stacked, NOISE, FIELD_PARAMS, 1 / 30, BOUNDS);
    for (const agent of next) {
      expect(Number.isFinite(agent.x)).toBe(true);
      expect(Number.isFinite(agent.velocityX)).toBe(true);
    }
  });

  it('separates two agents that start on the same point', () => {
    const stacked: readonly AmbientAgent[] = [
      { x: 400, y: 300, velocityX: 0, velocityY: 0 },
      { x: 400, y: 300, velocityX: 0, velocityY: 0 },
    ];
    let flock = stacked;
    for (let step = 0; step < 40; step += 1) {
      flock = stepAmbientFlock(flock, NOISE, FIELD_PARAMS, 1 / 30, BOUNDS);
    }
    const distance = Math.hypot(flock[0].x - flock[1].x, flock[0].y - flock[1].y);
    expect(distance).toBeGreaterThan(0);
  });
});

describe('buildAmbientFlock', () => {
  it('builds the count it is asked for, inside the field', () => {
    const flock = buildAmbientFlock(50, BOUNDS, createAmbientRandom(0.4));
    expect(flock).toHaveLength(50);
    for (const agent of flock) {
      expect(agent.x).toBeGreaterThanOrEqual(0);
      expect(agent.x).toBeLessThanOrEqual(BOUNDS.width);
    }
  });

  it('is reproducible from the seed', () => {
    expect(buildAmbientFlock(20, BOUNDS, createAmbientRandom(0.15)))
      .toStrictEqual(buildAmbientFlock(20, BOUNDS, createAmbientRandom(0.15)));
  });
});
