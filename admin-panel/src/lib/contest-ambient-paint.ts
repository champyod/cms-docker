/**
 * Canvas painters for the four ambient textures.
 *
 * Each texture's geometry is built once per roll and size and then reused, so a static
 * texture stays static: the traces and the glyph grid carry no frame randomness at all.
 * Only the values that are meant to move — the left-right drift, the flicker phase and
 * the two simulations — are recomputed per frame.
 *
 * The field is a discriminated union rather than a set of per-texture classes, so the
 * component holds one value and the compiler proves which texture it belongs to.
 */
import {
  AMBIENT_FLOW_SCALE,
  buildAmbientFlock,
  buildAmbientParticles,
  stepAmbientFlock,
  stepAmbientFlow,
  wrapCoordinate,
  type AmbientAgent,
  type AmbientBounds,
  type AmbientFieldParams,
  type AmbientVector,
} from '@/lib/contest-ambient-sim';
import { ambientColor, type AmbientPalette, type AmbientTextureId } from '@/lib/contest-ambient';

const TRACE_GAP_PX = 72;
const TRACE_PAD_RADIUS_PX = 4.5;
const TRACE_LINE_WIDTH_PX = 1.6;
const TRACE_PAD_CHANCE = 0.7;
const TRACE_ALPHA = 0.34;
const TRACE_PAD_ALPHA = 0.55;
/** Step along the band between turns; a small amplitude plus many turns fills the width. */
const TRACE_STEP_PX = 46;
/** Bounds the walk on a pathologically wide viewport. */
const MAX_TRACE_SEGMENTS = 240;

const GLYPH_CELL_PX = 46;
const GLYPH_FONT_PX = 13;
const GLYPH_FLICKER_FLOOR = 0.16;
const GLYPH_ALPHA = 0.42;
const GLYPH_ALPHABET = '0123456789ABCDEF';

const HARMONOGRAPH_CELL_PX = 190;
const HARMONOGRAPH_STEPS = 220;
const HARMONOGRAPH_RENDER_SCALE = 0.38;
const HARMONOGRAPH_LINE_WIDTH_PX = 1.1;
const HARMONOGRAPH_ALPHA = 0.5;
/** Integer frequency pairs, so every figure closes on itself and repeats exactly. */
const HARMONOGRAPH_FREQUENCIES: readonly (readonly [number, number])[] = [
  [3, 2], [5, 4], [5, 3], [7, 5], [4, 3], [7, 4],
];

const BOID_STREAK_SECONDS = 0.26;
const BOID_LINE_WIDTH_PX = 2.2;
const BOID_ALPHA = 0.8;
const FLOW_LINE_WIDTH_PX = 1.3;
/** Head and tail alphas, so a trail reads as a comet rather than a plain line. */
const FLOW_DIM_ALPHA = 0.09;
const FLOW_HEAD_ALPHA = 0.55;
/** Points kept per particle; longer trails are what make the current legible. */
const FLOW_TRAIL_LENGTH = 14;

export interface AmbientFrame {
  readonly bounds: AmbientBounds;
  readonly palette: AmbientPalette;
  /** Left-right sweep of the whole field for this frame, in pixels. */
  readonly driftPx: number;
  readonly progress: number;
  /** Grows with the ramp: objects are drawn larger as the threshold nears. */
  readonly density: number;
  /** Base size of every object, as a multiple of each texture's own size. */
  readonly itemScale: number;
  readonly deltaSeconds: number;
  readonly energy: number;
  /** Advances on a slow timer; the glyph flicker reads it instead of a per-frame random. */
  readonly flickerPhase: number;
  /** The seeded field the two simulations are carried by. */
  readonly noiseAt: (x: number, y: number) => number;
}

interface TraceSegment {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}

interface TraceRun {
  readonly segments: readonly TraceSegment[];
  readonly padX: number;
  readonly padY: number;
  readonly hasPad: boolean;
}

/**
 * One closed Lissajous figure, as a list of points. Both frequencies are integers, so the
 * curve returns exactly to its start and the figure is periodic — which is what lets the
 * grid of them tile without a seam.
 */
interface HarmonographFigure {
  readonly x: number;
  readonly y: number;
  readonly phase: number;
  readonly frequencies: readonly [number, number];
}

interface HarmonographCell {
  readonly x: number;
  readonly y: number;
  readonly figure: HarmonographFigure;
}

interface GlyphCell {
  readonly x: number;
  readonly y: number;
  readonly glyph: string;
  readonly flickerPhase: number;
}

/** One horizontal run per band, stepping up and down, so every trace reads as orthogonal. */
function buildTraceRun(width: number, random: () => number): TraceRun {
  const segments: TraceSegment[] = [];
  const amplitude = TRACE_GAP_PX * 0.48;
  // Start before the left edge and walk past the right one, so a run always spans the band.
  // The step length varies, so the turns do not line up into columns.
  let cursorX = -TRACE_STEP_PX;
  let cursorY = 0;
  while (cursorX < width + TRACE_STEP_PX && segments.length < MAX_TRACE_SEGMENTS) {
    const nextX = cursorX + TRACE_STEP_PX * (0.6 + random() * 0.9);
    segments.push({ fromX: cursorX, fromY: cursorY, toX: nextX, toY: cursorY });
    const nextY = cursorY + (random() < 0.5 ? -1 : 1) * amplitude * (0.5 + random() * 0.9);
    segments.push({ fromX: nextX, fromY: cursorY, toX: nextX, toY: nextY });
    cursorX = nextX;
    cursorY = nextY;
  }
  return { segments, padX: cursorX, padY: cursorY, hasPad: random() < TRACE_PAD_CHANCE };
}

function buildTraceRuns(bounds: AmbientBounds, random: () => number): readonly TraceRun[] {
  const runs: TraceRun[] = [];
  for (let y = TRACE_GAP_PX * 0.5; y < bounds.height + TRACE_GAP_PX; y += TRACE_GAP_PX) {
    const run = buildTraceRun(bounds.width, random);
    runs.push({
      segments: run.segments.map((segment) => ({
        fromX: segment.fromX,
        fromY: segment.fromY + y,
        toX: segment.toX,
        toY: segment.toY + y,
      })),
      padX: run.padX,
      padY: run.padY + y,
      hasPad: run.hasPad,
    });
  }
  return runs;
}

function buildGlyphCells(bounds: AmbientBounds, random: () => number): readonly GlyphCell[] {
  const cells: GlyphCell[] = [];
  const half = GLYPH_CELL_PX * 0.5;
  // Half a cell beyond each edge, so the cells either side of the seam exist. Without them
  // the drift opens a blank band at the left and right, because only whole cells inside the
  // bounds were ever built.
  for (let y = half; y < bounds.height + GLYPH_CELL_PX; y += GLYPH_CELL_PX) {
    for (let x = half; x < bounds.width + GLYPH_CELL_PX; x += GLYPH_CELL_PX) {
      cells.push({
        x,
        y,
        glyph: GLYPH_ALPHABET[Math.floor(random() * GLYPH_ALPHABET.length)],
        flickerPhase: random() * Math.PI * 2,
      });
    }
  }
  return cells;
}

/**
 * A grid of closed Lissajous figures, one per cell, each read as a small mathematical
 * drawing rather than as decoration.
 */
function buildHarmonographCells(bounds: AmbientBounds, random: () => number): readonly HarmonographCell[] {
  const cells: HarmonographCell[] = [];
  for (let y = HARMONOGRAPH_CELL_PX * 0.5; y < bounds.height + HARMONOGRAPH_CELL_PX; y += HARMONOGRAPH_CELL_PX) {
    for (let x = HARMONOGRAPH_CELL_PX * 0.5; x < bounds.width + HARMONOGRAPH_CELL_PX; x += HARMONOGRAPH_CELL_PX) {
      cells.push({
        x,
        y,
        figure: {
          x: HARMONOGRAPH_CELL_PX * HARMONOGRAPH_RENDER_SCALE,
          y: HARMONOGRAPH_CELL_PX * HARMONOGRAPH_RENDER_SCALE,
          phase: random() * Math.PI * 2,
          frequencies: HARMONOGRAPH_FREQUENCIES[Math.floor(random() * HARMONOGRAPH_FREQUENCIES.length)],
        },
      });
    }
  }
  return cells;
}

function paintHarmonograph(
  context: CanvasRenderingContext2D,
  frame: AmbientFrame,
  cells: readonly HarmonographCell[],
): void {
  const { width } = frame.bounds;
  context.lineWidth = HARMONOGRAPH_LINE_WIDTH_PX * objectSize(frame);
  context.strokeStyle = ambientColor(frame.palette, HARMONOGRAPH_ALPHA, frame.palette.accentHue);
  // Wrapped per cell, so a figure that crosses the edge reappears on the far side and the
  // band the drift opens is filled rather than left blank.
  const startX = wrapCoordinate(frame.driftPx, width);
  for (let tile = -1; tile <= 1; tile += 1) {
    const tileX = startX + tile * width;
    for (const cell of cells) {
      const centreX = tileX + cell.x;
      if (centreX < -HARMONOGRAPH_CELL_PX || centreX > width + HARMONOGRAPH_CELL_PX) continue;
      const { figure } = cell;
      context.beginPath();
      for (let step = 0; step <= HARMONOGRAPH_STEPS; step += 1) {
        const t = (step / HARMONOGRAPH_STEPS) * Math.PI * 2;
        const px = centreX + Math.sin(figure.frequencies[0] * t + figure.phase) * figure.x;
        const py = cell.y + Math.sin(figure.frequencies[1] * t) * figure.y;
        if (step === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.stroke();
    }
  }
}

export type AmbientField =
  | { readonly texture: 'traces'; readonly runs: readonly TraceRun[] }
  | { readonly texture: 'glyphs'; readonly cells: readonly GlyphCell[] }
  | { readonly texture: 'boids'; readonly agents: readonly AmbientAgent[] }
  | { readonly texture: 'flow'; readonly trails: readonly (readonly AmbientVector[])[] }
  | { readonly texture: 'harmonograph'; readonly cells: readonly HarmonographCell[] };

/** Geometry and starting state for one roll, rebuilt only when the size or seed changes. */
export function buildAmbientField(
  textureId: AmbientTextureId,
  bounds: AmbientBounds,
  agentCount: number,
  random: () => number,
): AmbientField {
  if (textureId === 'traces') return { texture: 'traces', runs: buildTraceRuns(bounds, random) };
  if (textureId === 'glyphs') return { texture: 'glyphs', cells: buildGlyphCells(bounds, random) };
  if (textureId === 'boids') return { texture: 'boids', agents: buildAmbientFlock(agentCount, bounds, random) };
  if (textureId === 'harmonograph') return { texture: 'harmonograph', cells: buildHarmonographCells(bounds, random) };
  return {
    texture: 'flow',
    trails: buildAmbientParticles(agentCount, bounds, random).map((particle) => [particle]),
  };
}

function paintTraces(context: CanvasRenderingContext2D, frame: AmbientFrame, runs: readonly TraceRun[]): void {
  const { width } = frame.bounds;
  const size = objectSize(frame);
  context.lineCap = 'round';
  context.lineWidth = TRACE_LINE_WIDTH_PX * size;
  context.strokeStyle = ambientColor(frame.palette, TRACE_ALPHA);
  context.fillStyle = ambientColor(frame.palette, TRACE_PAD_ALPHA, frame.palette.accentHue);

  // A run is drawn once per neighbouring tile, so a trace that leaves one side enters the
  // other rather than stopping at a seam. The start is wrapped into the first tile so the
  // copies line up regardless of where the drift has carried the field.
  const startX = wrapCoordinate(frame.driftPx, width);
  for (let tile = -1; tile <= 1; tile += 1) {
    const tileX = startX + tile * width;
    for (const run of runs) {
      context.beginPath();
      for (const segment of run.segments) {
        context.moveTo(tileX + segment.fromX, segment.fromY);
        context.lineTo(tileX + segment.toX, segment.toY);
      }
      context.stroke();
      if (run.hasPad) {
        context.beginPath();
        context.arc(tileX + run.padX, run.padY, TRACE_PAD_RADIUS_PX * size, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
}

function paintGlyphs(context: CanvasRenderingContext2D, frame: AmbientFrame, cells: readonly GlyphCell[]): void {
  const { width } = frame.bounds;
  // The glyphs grow with the ramp rather than dimming: bigger objects, never a fade.
  const size = GLYPH_FONT_PX * objectSize(frame);
  context.font = `${size}px ui-monospace, monospace`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const startX = wrapCoordinate(frame.driftPx, width);
  for (let tile = -1; tile <= 1; tile += 1) {
    const tileX = startX + tile * width;
    for (const cell of cells) {
      const wave = 0.5 + 0.5 * Math.sin(cell.flickerPhase + frame.flickerPhase);
      const flicker = GLYPH_FLICKER_FLOOR + (1 - GLYPH_FLICKER_FLOOR) * wave;
      context.fillStyle = ambientColor(frame.palette, flicker * GLYPH_ALPHA, frame.palette.accentHue);
      context.fillText(cell.glyph, tileX + cell.x, cell.y);
    }
  }
}

/**
 * One factor for every object size in the field: the base scale the reader chose, times the
 * growth the ramp has reached. Keeping it in one place is what makes a single setting resize
 * all four textures together.
 */
function objectSize(frame: AmbientFrame): number {
  return frame.itemScale * frame.density;
}

function fieldParams(frame: AmbientFrame): AmbientFieldParams {
  return { driftX: frame.driftPx * AMBIENT_FLOW_SCALE, energy: frame.energy };
}

function paintBoids(
  context: CanvasRenderingContext2D,
  frame: AmbientFrame,
  agents: readonly AmbientAgent[],
): readonly AmbientAgent[] {
  const advanced = stepAmbientFlock(agents, frame.noiseAt, fieldParams(frame), frame.deltaSeconds, frame.bounds);
  context.strokeStyle = ambientColor(frame.palette, BOID_ALPHA);
  context.lineWidth = BOID_LINE_WIDTH_PX * objectSize(frame);
  context.lineCap = 'round';
  const streak = BOID_STREAK_SECONDS * objectSize(frame);
  for (const agent of advanced) {
    context.beginPath();
    context.moveTo(agent.x, agent.y);
    context.lineTo(agent.x - agent.velocityX * streak, agent.y - agent.velocityY * streak);
    context.stroke();
  }
  return advanced;
}

/**
 * Each particle keeps a short trail, drawn dark at the tail and bright at the head. A
 * single segment per frame would be sub-pixel at this pace, which reads as nothing.
 */
function paintFlow(
  context: CanvasRenderingContext2D,
  frame: AmbientFrame,
  trails: readonly (readonly AmbientVector[])[],
): readonly (readonly AmbientVector[])[] {
  const advanced: (readonly AmbientVector[])[] = [];
  context.lineWidth = FLOW_LINE_WIDTH_PX * objectSize(frame);
  context.lineCap = 'round';
  const dimColor = ambientColor(frame.palette, FLOW_DIM_ALPHA, frame.palette.accentHue);
  const headColor = ambientColor(frame.palette, FLOW_HEAD_ALPHA, frame.palette.accentHue);

  for (const trail of trails) {
    const head = trail[trail.length - 1];
    const next = stepAmbientFlow(head, frame.noiseAt, fieldParams(frame), frame.deltaSeconds, frame.bounds);
    const grown = [...trail, next].slice(-FLOW_TRAIL_LENGTH);
    advanced.push(grown);
    if (grown.length < 2) continue;

    // A step that wrapped crossed an edge, so the two touches are drawn apart rather than
    // as one stroke straight across the field.
    const split = Math.max(1, grown.length - 3);
    drawTrail(context, grown.slice(0, split + 1), dimColor);
    drawTrail(context, grown.slice(split), headColor);
  }
  return advanced;
}

/** One stroke through a trail, broken wherever a step wrapped past the field's edge. */
function drawTrail(
  context: CanvasRenderingContext2D,
  points: readonly AmbientVector[],
  color: string,
): void {
  if (points.length < 2) return;
  context.strokeStyle = color;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (Math.abs(current.x - previous.x) > WRAP_BREAK_PX || Math.abs(current.y - previous.y) > WRAP_BREAK_PX) {
      context.stroke();
      context.beginPath();
      context.moveTo(current.x, current.y);
      continue;
    }
    context.lineTo(current.x, current.y);
  }
  context.stroke();
}

/** A step longer than this is a wrap, not travel, so the stroke is broken there. */
const WRAP_BREAK_PX = 120;

/** Paints one frame and returns the field advanced by it. Static fields come back as they went in. */
export function paintAmbientField(
  context: CanvasRenderingContext2D,
  frame: AmbientFrame,
  field: AmbientField,
): AmbientField {
  switch (field.texture) {
    case 'traces':
      paintTraces(context, frame, field.runs);
      return field;
    case 'glyphs':
      paintGlyphs(context, frame, field.cells);
      return field;
    case 'boids':
      return { texture: 'boids', agents: paintBoids(context, frame, field.agents) };
    case 'flow':
      return { texture: 'flow', trails: paintFlow(context, frame, field.trails) };
    case 'harmonograph':
      paintHarmonograph(context, frame, field.cells);
      return field;
  }
}
