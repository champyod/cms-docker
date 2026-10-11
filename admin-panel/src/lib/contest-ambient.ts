/**
 * The idle bar's ambient field: one draw fixes its colour, its texture and its pace,
 * and time turns that texture into a blurred bed as the threshold arrives.
 *
 * Every texture is abstract — circuit traces, a glyph grid, a flock, a flow field. None
 * of them spells anything or encodes an algorithm, so the field cannot hint at what the
 * countdown is counting to.
 */

export const AMBIENT_TEXTURE_IDS = ['traces', 'glyphs', 'boids', 'flow'] as const;

export type AmbientTextureId = (typeof AMBIENT_TEXTURE_IDS)[number];

/** Each texture carries its own pace, so the roll changes the feel and not only the colour. */
export interface AmbientTexture {
  readonly id: AmbientTextureId;
  readonly label: string;
  readonly driftSecondsRange: readonly [number, number];
  /** Agents for the two simulated textures; ignored by the two static ones. */
  readonly agentCount: number;
}

export interface AmbientPalette {
  readonly id: string;
  readonly glowHue: number;
  readonly accentHue: number;
  readonly saturation: number;
  readonly lightness: number;
}

export const AMBIENT_PALETTES: readonly AmbientPalette[] = [
  { id: 'indigo', glowHue: 243, accentHue: 205, saturation: 76, lightness: 62 },
  { id: 'cyan', glowHue: 190, accentHue: 158, saturation: 74, lightness: 60 },
  { id: 'mint', glowHue: 162, accentHue: 196, saturation: 70, lightness: 58 },
  { id: 'violet', glowHue: 276, accentHue: 318, saturation: 72, lightness: 64 },
  { id: 'amber', glowHue: 36, accentHue: 14, saturation: 78, lightness: 60 },
  { id: 'slate', glowHue: 214, accentHue: 250, saturation: 62, lightness: 64 },
];

export interface AmbientConfig {
  readonly rerollMs: number;
  /** Span the blur climbs across where no countdown window applies, such as an ended contest. */
  readonly fallbackProgressMs: number;
  /** Pixels the field sweeps either side of centre, as a share of its width. */
  readonly driftExtentRatio: number;
  /**
   * Base size of every object the field draws, as a multiple of each texture's own size.
   * Items are drawn across the whole surface including the middle, so this stays bounded:
   * past the ceiling an item stops reading as background and starts competing with the
   * timer that sits on top of it.
   */
  readonly itemScale: number;
  /** How much larger the objects grow across the ramp, as a fraction of their base size. */
  readonly growthGain: number;
  /** Seconds one full cycle of the ended screen's reveal takes. */
  readonly markRevealMs: number;
  /** Pin the field's texture, or 'auto' to let the seed choose. */
  readonly textureId: AmbientTextureIdChoice;
  /** Pin the ended screen's ornament, or 'auto' to let the seed choose. */
  readonly ornamentId: AmbientOrnamentIdChoice;
  /** Frame cap, so a high-refresh display does not spend four times the work per second. */
  readonly maxFramesPerSecond: number;
}

export const DEFAULT_AMBIENT_CONFIG: AmbientConfig = {
  rerollMs: 45_000,
  fallbackProgressMs: 600_000,
  driftExtentRatio: 0.045,
  itemScale: 1.6,
  growthGain: 0.35,
  markRevealMs: 2_600,
  textureId: 'auto',
  ornamentId: 'auto',
  maxFramesPerSecond: 30,
};

/** Bounds on the size knobs, so a mistyped value cannot fill the surface or erase the field. */
/** Ceiling is 2.5: the field draws under the timer, so larger items would crowd it. */
export const AMBIENT_ITEM_SCALE_RANGE: readonly [number, number] = [0.4, 2.5];
export const AMBIENT_GROWTH_GAIN_RANGE: readonly [number, number] = [0, 2];
export const AMBIENT_MARK_REVEAL_MS_RANGE: readonly [number, number] = [600, 20_000];

/** 'auto' keeps the seeded roll; naming one pins it, so the screen is reproducible by request. */
export type AmbientTextureIdChoice = AmbientTextureId | 'auto';
export type AmbientOrnamentIdChoice = AmbientOrnamentId | 'auto';

export const AMBIENT_TEXTURES: readonly AmbientTexture[] = [
  { id: 'traces', label: 'Circuit traces', driftSecondsRange: [34, 52], agentCount: 0 },
  { id: 'glyphs', label: 'Glyph grid', driftSecondsRange: [26, 40], agentCount: 0 },
  { id: 'boids', label: 'Flock', driftSecondsRange: [30, 44], agentCount: 110 },
  { id: 'flow', label: 'Flow field', driftSecondsRange: [36, 54], agentCount: 260 },
];

/**
 * The ramp still completes in five 20% steps even though nothing blurs any more: the
 * steps are what the field's own density and pace are scaled by on the way to the
 * threshold, and the last one is where the timer's bed appears.
 */
export const AMBIENT_STEP_COUNT = 5;

export const AMBIENT_STEP_FRACTION = 1 / AMBIENT_STEP_COUNT;

export interface AmbientRoll {
  readonly seed: number;
  readonly texture: AmbientTexture;
  readonly palette: AmbientPalette;
  readonly driftSeconds: number;
}

const AMBIENT_SEED_SCALE = 0xffff_ffff;
const MULBERRY_INCREMENT = 0x6d2b_79f5;

/**
 * A seeded stream, so a roll alone reproduces its texture — the same seed redraws
 * the same field after a resize, and a test can assert the draw without a canvas.
 */
export function createAmbientRandom(seed: number): () => number {
  let state = Math.floor(seed * AMBIENT_SEED_SCALE) || 1;
  return () => {
    state = (state + MULBERRY_INCREMENT) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function pick<T>(options: readonly T[], random: () => number): T {
  return options[Math.min(options.length - 1, Math.floor(random() * options.length))];
}

/**
 * One seed, one roll: colour, texture and pace all come from this single draw. A pinned
 * texture overrides only the texture; the colour and the pace still come from the seed, so a
 * pinned screen is still different on every visit.
 */
export function rollAmbient(seed: number, textureId: AmbientTextureIdChoice = 'auto'): AmbientRoll {
  const random = createAmbientRandom(seed);
  const drawn = pick(AMBIENT_TEXTURES, random);
  const palette = pick(AMBIENT_PALETTES, random);
  const texture = textureId === 'auto'
    ? drawn
    : AMBIENT_TEXTURES.find((candidate) => candidate.id === textureId) ?? drawn;
  const [slowest, fastest] = texture.driftSecondsRange;
  return {
    seed,
    texture,
    palette,
    driftSeconds: slowest + random() * Math.max(0, fastest - slowest),
  };
}

function clampFraction(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * The ornaments the ended screen turns in its front layer.
 *
 * Deliberately a separate set from the field's textures: an ornament is a single object read
 * as one shape, while a texture is a pattern read as a mass, and reusing the swarm's flock or
 * flow as the ornament would read as the field having merely moved forward. All four are pure
 * geometry, so none of them can hint at what the screen is for.
 */
export const AMBIENT_ORNAMENT_IDS = ['rings', 'ticks', 'spokes', 'nested'] as const;

export type AmbientOrnamentId = (typeof AMBIENT_ORNAMENT_IDS)[number];

export interface AmbientOrnamentRoll {
  readonly ornament: AmbientOrnamentId;
  readonly palette: AmbientPalette;
}

/**
 * The ornament for a seed. Offsets the seed first, so the ornament a seed picks is not the
 * texture that same seed picks — otherwise every roll would show a matching pair.
 */
export function rollOrnament(seed: number, ornamentId: AmbientOrnamentIdChoice = 'auto'): AmbientOrnamentRoll {
  const random = createAmbientRandom(seed + AMBIENT_ORNAMENT_SEED_OFFSET);
  const drawn = pick(AMBIENT_ORNAMENT_IDS, random);
  return {
    ornament: ornamentId === 'auto' ? drawn : ornamentId,
    palette: pick(AMBIENT_PALETTES, random),
  };
}

/** Any offset that is not zero keeps the two draws independent. */
const AMBIENT_ORNAMENT_SEED_OFFSET = 0.517;

/** Bounds the reveal, so a mistyped value cannot flash the mark or stall it. */
export function clampMarkRevealMs(revealMs: number): number {
  if (!Number.isFinite(revealMs)) return DEFAULT_AMBIENT_CONFIG.markRevealMs;
  const [fastest, slowest] = AMBIENT_MARK_REVEAL_MS_RANGE;
  return Math.min(slowest, Math.max(fastest, revealMs));
}

export interface AmbientProgressParams {
  /** Null until the first roll, which only ever happens in an effect. */
  readonly startedAtMs: number | null;
  /** The threshold instant; null where the countdown has no target to measure to. */
  readonly completeAtMs: number | null;
  readonly nowMs: number;
  readonly fallbackMs: number;
}

/** How far the field has travelled from its start to the threshold, as 0 to 1. */
export function resolveAmbientProgress(params: AmbientProgressParams): number {
  const { startedAtMs, completeAtMs, nowMs, fallbackMs } = params;
  if (startedAtMs === null) return 0;
  if (completeAtMs !== null) {
    if (nowMs >= completeAtMs) return 1;
    return clampFraction((nowMs - startedAtMs) / (completeAtMs - startedAtMs));
  }
  return clampFraction((nowMs - startedAtMs) / fallbackMs);
}

/** The progress quantised into the 20% steps the field's density is scaled by. */
export function resolveAmbientStep(progress: number): number {
  const step = Math.floor(clampFraction(progress) * AMBIENT_STEP_COUNT);
  return Math.min(AMBIENT_STEP_COUNT, Math.max(0, step));
}

/**
 * How strongly the field is drawn at a step. Objects are drawn *larger* as the ramp
 * climbs rather than softened, which is what carries the sense of approach once the blur
 * is gone.
 */
export function ambientDensityScale(step: number, growthGain: number = AMBIENT_DENSITY_GAIN): number {
  const bounded = Math.min(AMBIENT_STEP_COUNT, Math.max(0, step));
  const gain = clampGrowthGain(growthGain);
  return 1 + (bounded / AMBIENT_STEP_COUNT) * gain;
}

/** Default growth across the whole ramp; a third larger by the threshold reads without crowding. */
export const AMBIENT_DENSITY_GAIN = 0.35;

export function clampGrowthGain(gain: number): number {
  if (!Number.isFinite(gain)) return AMBIENT_DENSITY_GAIN;
  return Math.min(AMBIENT_GROWTH_GAIN_RANGE[1], Math.max(AMBIENT_GROWTH_GAIN_RANGE[0], gain));
}

export function clampItemScale(scale: number): number {
  if (!Number.isFinite(scale)) return DEFAULT_AMBIENT_CONFIG.itemScale;
  return Math.min(AMBIENT_ITEM_SCALE_RANGE[1], Math.max(AMBIENT_ITEM_SCALE_RANGE[0], scale));
}

/** True only at the last step, where the field has fully arrived and the timer bed may show. */
export function isAmbientRampComplete(step: number): boolean {
  return step >= AMBIENT_STEP_COUNT;
}

export function ambientColor(palette: AmbientPalette, alpha: number, hue: number = palette.glowHue): string {
  const normalizedHue = ((hue % 360) + 360) % 360;
  return `hsl(${normalizedHue} ${palette.saturation}% ${palette.lightness}% / ${clampFraction(alpha)})`;
}
