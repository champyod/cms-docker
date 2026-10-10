/** How long one figure holds the screen before another takes its turn. */
export const RUNNER_SHAPE_ROTATION_MS = 600_000;

export const RUNNER_SHAPE_IDS = ['spiky', 'tumbler', 'stickman', 'blob'] as const;

export type RunnerShapeId = (typeof RUNNER_SHAPE_IDS)[number];

const HASH_SEED = 12.9898;
const HASH_SCALE = 43758.5453;

/**
 * The figure for a turn. Deterministic rather than drawn from Math.random,
 * because the server and the first client render must agree; the scramble is
 * enough that the sequence still reads as arbitrary.
 */
export function shapeForTurn(turn: number): RunnerShapeId {
  const scrambled = Math.abs(Math.sin(turn * HASH_SEED) * HASH_SCALE);
  return RUNNER_SHAPE_IDS[Math.floor(scrambled) % RUNNER_SHAPE_IDS.length];
}
