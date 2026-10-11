/**
 * The simulation cores behind the ambient field: a flock driven by boids rules, and
 * particles carried by a seeded gradient field. Both are pure — state in, next state
 * out, no canvas and no Math.random — so the motion is testable on its own.
 *
 * The two static textures (circuit traces, glyph grid) need no state and live in the
 * painters instead.
 */

export interface AmbientVector {
  readonly x: number;
  readonly y: number;
}

export interface AmbientBounds {
  readonly width: number;
  readonly height: number;
}

/** Field coordinates per pixel: one noise cell spans this many pixels of texture. */
export const AMBIENT_FLOW_SCALE = 1 / 240;
const FULL_TURN = Math.PI * 2;

export interface AmbientFieldParams {
  /** Left-right sweep of the whole field, in field coordinates. */
  readonly driftX: number;
  /** Falls as the countdown nears its threshold, so the field quiets instead of racing. */
  readonly energy: number;
}

/**
 * Wrap a coordinate into its extent. Unlike a plain modulo this cannot return the
 * extent itself, so an agent never lands exactly on the seam.
 */
export function wrapCoordinate(value: number, extent: number): number {
  if (extent <= 0 || !Number.isFinite(value)) return 0;
  return ((value % extent) + extent) % extent;
}

/** The flow angle at a point, in radians, as the noise field reports it. */
export function ambientFlowAngle(
  point: AmbientVector,
  noiseAt: (x: number, y: number) => number,
  driftX: number,
): number {
  return noiseAt(point.x * AMBIENT_FLOW_SCALE + driftX, point.y * AMBIENT_FLOW_SCALE) * FULL_TURN;
}

export const AMBIENT_FLOW_SPEED_PX_PER_SECOND = 26;

/** One particle carried one step along the field. */
export function stepAmbientFlow(
  point: AmbientVector,
  noiseAt: (x: number, y: number) => number,
  params: AmbientFieldParams,
  deltaSeconds: number,
  bounds: AmbientBounds,
): AmbientVector {
  const angle = ambientFlowAngle(point, noiseAt, params.driftX);
  const step = AMBIENT_FLOW_SPEED_PX_PER_SECOND * params.energy * deltaSeconds;
  return {
    x: wrapCoordinate(point.x + Math.cos(angle) * step, bounds.width),
    y: wrapCoordinate(point.y + Math.sin(angle) * step, bounds.height),
  };
}

export interface AmbientAgent extends AmbientVector {
  velocityX: number;
  velocityY: number;
}

export const AMBIENT_BOID_NEIGHBOURHOOD_PX = 72;
export const AMBIENT_BOID_SEPARATION_PX = 40;
export const AMBIENT_BOID_MAX_SPEED_PX_PER_SECOND = 68;
export const AMBIENT_BOID_MAX_STEER_PX_PER_SECOND_SQUARED = 150;

export interface AmbientBoidWeights {
  readonly separation: number;
  readonly alignment: number;
  readonly cohesion: number;
  readonly flow: number;
}

export const DEFAULT_AMBIENT_BOID_WEIGHTS: AmbientBoidWeights = {
  separation: 2.6,
  alignment: 1.5,
  cohesion: 0.5,
  flow: 1.3,
};

export interface AmbientBoidParams extends AmbientFieldParams {
  readonly weights?: AmbientBoidWeights;
}

interface NeighbourSummary {
  readonly count: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly centreX: number;
  readonly centreY: number;
  readonly separationX: number;
  readonly separationY: number;
}

const EMPTY_NEIGHBOURS: NeighbourSummary = {
  count: 0, velocityX: 0, velocityY: 0, centreX: 0, centreY: 0, separationX: 0, separationY: 0,
};

/** 
 * Irrational angle and a fixed distance, used only to push apart agents that share a
 * position: the pair's indices choose the direction, so the result is still reproducible.
 */
const COINCIDENT_NUDGE_RADIANS = 2.399963;
const COINCIDENT_NUDGE_PX = 0.5;

/**
 * One pass over the flock for the agent's neighbours. A squared-distance test is used
 * because the count is small enough that a spatial index would cost more than it saves.
 */
function summariseNeighbours(
  agentIndex: number,
  agent: AmbientAgent,
  flock: readonly AmbientAgent[],
): NeighbourSummary {
  const neighbourhoodSquared = AMBIENT_BOID_NEIGHBOURHOOD_PX * AMBIENT_BOID_NEIGHBOURHOOD_PX;
  const separationSquared = AMBIENT_BOID_SEPARATION_PX * AMBIENT_BOID_SEPARATION_PX;
  let summary: NeighbourSummary = EMPTY_NEIGHBOURS;

  for (let otherIndex = 0; otherIndex < flock.length; otherIndex += 1) {
    if (otherIndex === agentIndex) continue;
    const other = flock[otherIndex];
    const offsetX = other.x - agent.x;
    const offsetY = other.y - agent.y;
    const distanceSquared = offsetX * offsetX + offsetY * offsetY;
    if (distanceSquared > neighbourhoodSquared) continue;

    // Coincident agents share no direction to separate along, so a deterministic nudge
    // derived from the two indices is used instead of dividing by zero. The indices are
    // subtracted rather than added so the two agents are pushed opposite ways.
    const isCoincident = distanceSquared === 0;
    let pushX = 0;
    let pushY = 0;
    if (isCoincident) {
      const angle = (agentIndex - otherIndex) * COINCIDENT_NUDGE_RADIANS;
      pushX = Math.cos(angle) * COINCIDENT_NUDGE_PX;
      pushY = Math.sin(angle) * COINCIDENT_NUDGE_PX;
    } else if (distanceSquared < separationSquared) {
      pushX = -offsetX / distanceSquared;
      pushY = -offsetY / distanceSquared;
    }

    summary = {
      count: summary.count + 1,
      velocityX: summary.velocityX + other.velocityX,
      velocityY: summary.velocityY + other.velocityY,
      centreX: summary.centreX + other.x,
      centreY: summary.centreY + other.y,
      separationX: summary.separationX + pushX,
      separationY: summary.separationY + pushY,
    };
  }
  return summary;
}

/** Separates, aligns and coheres toward the neighbours, all in one vector. */
function boidSteering(agent: AmbientAgent, summary: NeighbourSummary, weights: AmbientBoidWeights): AmbientVector {
  if (summary.count === 0) return { x: 0, y: 0 };
  const averageVelocityX = summary.velocityX / summary.count - agent.velocityX;
  const averageVelocityY = summary.velocityY / summary.count - agent.velocityY;
  const towardCentreX = summary.centreX / summary.count - agent.x;
  const towardCentreY = summary.centreY / summary.count - agent.y;
  return {
    x: summary.separationX * weights.separation
      + averageVelocityX * weights.alignment
      + towardCentreX * weights.cohesion,
    y: summary.separationY * weights.separation
      + averageVelocityY * weights.alignment
      + towardCentreY * weights.cohesion,
  };
}

/** Caps the steering force, so one crowded frame cannot fling an agent across the field. */
function limitSteering(steer: AmbientVector): AmbientVector {
  const magnitude = Math.hypot(steer.x, steer.y);
  if (magnitude <= AMBIENT_BOID_MAX_STEER_PX_PER_SECOND_SQUARED || magnitude === 0) return steer;
  const scale = AMBIENT_BOID_MAX_STEER_PX_PER_SECOND_SQUARED / magnitude;
  return { x: steer.x * scale, y: steer.y * scale };
}

/** Caps the speed, so every agent keeps to the pace the energy allows. */
function limitSpeed(velocity: AmbientVector, limit: number): AmbientVector {
  const speed = Math.hypot(velocity.x, velocity.y);
  if (speed <= limit || speed === 0) return velocity;
  return { x: (velocity.x / speed) * limit, y: (velocity.y / speed) * limit };
}

/**
 * A gentle pull back toward the middle, so a flock that reaches an edge does not pile up
 * along it. Wrapping alone is not enough: agents that drift past a side are carried the
 * same way, so without this every one of them ends up in the same corner.
 */
function containmentSteering(agent: AmbientAgent, bounds: AmbientBounds): AmbientVector {
  const marginX = Math.max(1, bounds.width * CONTAINMENT_MARGIN_RATIO);
  const marginY = Math.max(1, bounds.height * CONTAINMENT_MARGIN_RATIO);
  const fromLeft = agent.x / marginX;
  const fromRight = (bounds.width - agent.x) / marginX;
  const fromTop = agent.y / marginY;
  const fromBottom = (bounds.height - agent.y) / marginY;
  return {
    x: (1 - Math.min(1, fromLeft)) * CONTAINMENT_STRENGTH
      - (1 - Math.min(1, fromRight)) * CONTAINMENT_STRENGTH,
    y: (1 - Math.min(1, fromTop)) * CONTAINMENT_STRENGTH
      - (1 - Math.min(1, fromBottom)) * CONTAINMENT_STRENGTH,
  };
}

/** Share of the field treated as an edge band, and the pull applied inside it. */
const CONTAINMENT_MARGIN_RATIO = 0.18;
const CONTAINMENT_STRENGTH = 0.9;

/**
 * One boids step. The flock is also pulled along the flow field and, near an edge, back
 * toward the middle, so the three rules read as one current rather than as three
 * unrelated motions and the field stays evenly filled.
 */
export function stepAmbientFlock(
  flock: readonly AmbientAgent[],
  noiseAt: (x: number, y: number) => number,
  params: AmbientBoidParams,
  deltaSeconds: number,
  bounds: AmbientBounds,
): readonly AmbientAgent[] {
  const weights = params.weights ?? DEFAULT_AMBIENT_BOID_WEIGHTS;
  const speedLimit = AMBIENT_BOID_MAX_SPEED_PX_PER_SECOND * params.energy;

  return flock.map((agent, agentIndex) => {
    const steering = boidSteering(agent, summariseNeighbours(agentIndex, agent, flock), weights);
    const flowAngle = ambientFlowAngle(agent, noiseAt, params.driftX);
    const containment = containmentSteering(agent, bounds);
    const total = limitSteering({
      x: steering.x + Math.cos(flowAngle) * weights.flow + containment.x,
      y: steering.y + Math.sin(flowAngle) * weights.flow + containment.y,
    });
    const velocity = limitSpeed({
      x: agent.velocityX + total.x * deltaSeconds,
      y: agent.velocityY + total.y * deltaSeconds,
    }, Math.max(0, speedLimit));
    return {
      x: wrapCoordinate(agent.x + velocity.x * deltaSeconds, bounds.width),
      y: wrapCoordinate(agent.y + velocity.y * deltaSeconds, bounds.height),
      velocityX: velocity.x,
      velocityY: velocity.y,
    };
  });
}

/** A flock scattered across the field, seeded so a roll reproduces its starting state. */
export function buildAmbientFlock(
  count: number,
  bounds: AmbientBounds,
  random: () => number,
): readonly AmbientAgent[] {
  return Array.from({ length: count }, () => {
    const angle = random() * FULL_TURN;
    const speed = (0.35 + random() * 0.65) * AMBIENT_BOID_MAX_SPEED_PX_PER_SECOND;
    return {
      x: random() * bounds.width,
      y: random() * bounds.height,
      velocityX: Math.cos(angle) * speed,
      velocityY: Math.sin(angle) * speed,
    };
  });
}

/** Particles spread over the field for the flow texture. */
export function buildAmbientParticles(
  count: number,
  bounds: AmbientBounds,
  random: () => number,
): readonly AmbientVector[] {
  return Array.from({ length: count }, () => ({
    x: random() * bounds.width,
    y: random() * bounds.height,
  }));
}

/**
 * Left-right drift offset in pixels. Returns a signed pixel value.
 */
export function ambientDriftOffset(elapsedSeconds: number, periodSeconds: number, extentPx: number): number {
  if (periodSeconds <= 0) return 0;
  return Math.sin((elapsedSeconds / periodSeconds) * FULL_TURN) * extentPx;
}

/**
 * Vertical drift offset in pixels.  Uses a phase-shifted sine (quarter turn ahead of
 * the horizontal) so X and Y are always out of phase — the field travels in an ellipse
 * rather than bouncing on a straight line, which reads as genuinely 2-D motion.
 */
export function ambientDriftOffsetY(elapsedSeconds: number, periodSeconds: number, extentPx: number): number {
  if (periodSeconds <= 0) return 0;
  // Quarter-period offset so Y is 90° ahead of X, giving elliptical motion.
  const quarterPeriod = periodSeconds * 0.25;
  return Math.sin(((elapsedSeconds + quarterPeriod) / periodSeconds) * FULL_TURN) * extentPx;
}
