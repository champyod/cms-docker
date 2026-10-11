/**
 * Seeded gradient noise for the ambient field. The field's textures must be
 * reproducible from the roll alone, so the permutation table comes from the same
 * seeded stream the colour and style do and never from Math.random.
 */

const NOISE_PERMUTATION_SIZE = 256;
const NOISE_PERMUTATION_MASK = NOISE_PERMUTATION_SIZE - 1;
const NOISE_PERMUTATION_LENGTH = NOISE_PERMUTATION_SIZE * 2;
/** Unit gradients keep the interpolated value near 0.707, so the clamp below is only a guard. */
const NOISE_UNIT_DIAGONAL = Math.SQRT1_2;
const NOISE_GAIN = Math.SQRT2;

export interface AmbientNoise {
  /** Gradient noise in the range -1 to 1. */
  at(x: number, y: number): number;
  /** Stacked octaves, for textures that need detail at more than one scale. */
  fbm(x: number, y: number, octaves: number): number;
}

/** A shuffle of the permutation table that only depends on the seed it is given. */
function buildPermutation(seed: number): Uint8Array {
  const table = new Uint8Array(NOISE_PERMUTATION_LENGTH);
  for (let index = 0; index < NOISE_PERMUTATION_SIZE; index += 1) table[index] = index;
  let state = Math.floor(seed * 0xffff_ffff) || 1;
  for (let index = NOISE_PERMUTATION_SIZE - 1; index > 0; index -= 1) {
    state = (state + 0x6d2b_79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    const swap = ((mixed ^ (mixed >>> 14)) >>> 0) % (index + 1);
    const held = table[index];
    table[index] = table[swap];
    table[swap] = held;
  }
  for (let index = 0; index < NOISE_PERMUTATION_SIZE; index += 1) {
    table[NOISE_PERMUTATION_SIZE + index] = table[index];
  }
  return table;
}

/** Fade curve whose first and second derivatives vanish at both ends. */
function smooth(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

/** These gradients put the interpolated value a little outside -1 to 1, so it is clamped. */
function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value * NOISE_GAIN));
}

/** Eight unit-length directions, so no gradient biases the field toward an axis. */
function gradientDot(hash: number, x: number, y: number): number {
  switch (hash & 7) {
    case 0: return x;
    case 1: return x * NOISE_UNIT_DIAGONAL + y * NOISE_UNIT_DIAGONAL;
    case 2: return y;
    case 3: return -x * NOISE_UNIT_DIAGONAL + y * NOISE_UNIT_DIAGONAL;
    case 4: return -x;
    case 5: return -x * NOISE_UNIT_DIAGONAL - y * NOISE_UNIT_DIAGONAL;
    case 6: return -y;
    default: return x * NOISE_UNIT_DIAGONAL - y * NOISE_UNIT_DIAGONAL;
  }
}

export function createAmbientNoise(seed: number): AmbientNoise {
  const permutation = buildPermutation(seed);

  const at = (x: number, y: number): number => {
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    const localX = x - cellX;
    const localY = y - cellY;
    const wrappedX = cellX & NOISE_PERMUTATION_MASK;
    const wrappedY = cellY & NOISE_PERMUTATION_MASK;
    const fadedX = smooth(localX);
    const fadedY = smooth(localY);

    const cornerBottomLeft = permutation[wrappedX] + wrappedY;
    const cornerBottomRight = permutation[wrappedX + 1] + wrappedY;
    const cornerTopLeft = permutation[wrappedX] + wrappedY + 1;
    const cornerTopRight = permutation[wrappedX + 1] + wrappedY + 1;

    const bottom = gradientDot(permutation[cornerBottomLeft], localX, localY) * (1 - fadedX)
      + gradientDot(permutation[cornerBottomRight], localX - 1, localY) * fadedX;
    const top = gradientDot(permutation[cornerTopLeft], localX, localY - 1) * (1 - fadedX)
      + gradientDot(permutation[cornerTopRight], localX - 1, localY - 1) * fadedX;

    return clampUnit(bottom * (1 - fadedY) + top * fadedY);
  };

  const fbm = (x: number, y: number, octaves: number): number => {
    let amplitude = 0.5;
    let frequency = 1;
    let total = 0;
    let norm = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
      total += at(x * frequency, y * frequency) * amplitude;
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return norm > 0 ? total / norm : 0;
  };

  return { at, fbm };
}
