/**
 * Canonical wall-clock to instant conversion for the admin panel: pickers render wall clocks in the
 * contest's own zone and submit UTC instants, displays render an instant in the owner contest's
 * zone, and `Intl` is the only tool here so zone data always matches the runtime's tz database.
 */

/** A wall clock as calendar fields, with no offset attached. */
type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Distinct zone offsets probed around a wall clock, and the instants that read back as it. */
type ZoneCandidates = { offsets: readonly number[]; instants: readonly number[] };

const SECOND_MS = 1_000;
const DAY_MS = 86_400_000;
const UTC = 'UTC';
const PROBE_DELTAS_MS: readonly number[] = [-DAY_MS, 0, DAY_MS];
const WALL_CLOCK_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const GAP_VERB = 'DST begins, clocks jump';
const REPEAT_VERB = 'DST ends, clocks go back';
const ZONE_CLOCK_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
};
const formatterCache = new Map<string, Intl.DateTimeFormat>();

const pad2 = (value: number): string => String(value).padStart(2, '0');
const floorSecond = (epochMs: number): number => Math.floor(epochMs / SECOND_MS) * SECOND_MS;
const wallEpochMs = (wall: WallClock): number =>
  Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
const browserZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
const wallClockTimeLabel = (wall: WallClock): string => `${pad2(wall.hour)}:${pad2(wall.minute)}`;
const wallClockDateLabel = (wall: WallClock): string => `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}`;
const utcInstantLabel = (instant: Date): string => `${wallClockTimeLabel(readWallClock(instant, UTC))}Z`;
const toInstant = (epochMs: number): Date => new Date(epochMs);

function zoneFormatter(zone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(zone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-GB', { ...ZONE_CLOCK_OPTIONS, timeZone: zone });
  formatterCache.set(zone, created);
  return created;
}

function readWallClock(instant: Date, zone: string): WallClock {
  const values = new Map<string, number>();
  for (const part of zoneFormatter(zone).formatToParts(instant)) {
    if (part.type !== 'literal') values.set(part.type, Number(part.value));
  }
  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = values.get(type);
    if (value === undefined) throw new Error(`Intl returned no ${type} part for zone ${zone}`);
    return value;
  };
  return {
    year: field('year'), month: field('month'), day: field('day'),
    hour: field('hour'), minute: field('minute'), second: field('second'),
  };
}

/** Offset east of UTC in milliseconds at one instant; positive east, as tz data reports it. */
function zoneOffsetMs(instant: Date, zone: string): number {
  const floored = floorSecond(instant.getTime());
  return wallEpochMs(readWallClock(new Date(floored), zone)) - floored;
}

function isSupportedZone(zone: string): boolean {
  if (zone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Every export resolves its zone through here, so an unusable zone string falls back silently. */
function effectiveZone(zone: string): string {
  return isSupportedZone(zone) ? zone : browserZone();
}

/** The parsed wall clock, or null when the text is not one; the round-trip rejects impossible dates. */
function parseWallClock(value: string): WallClock | null {
  const match = WALL_CLOCK_PATTERN.exec(value);
  if (!match) return null;
  const wall: WallClock = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] ?? '0'),
  };
  const naive = wallEpochMs(wall);
  return wallEpochMs(readWallClock(new Date(naive), UTC)) === naive ? wall : null;
}

/**
 * Offset-before/offset-after probing: read the zone's offset with the wall clock read as UTC and
 * one day either side, keeping every offset whose instant renders back to the same wall clock.
 */
function zoneCandidates(wall: WallClock, zone: string): ZoneCandidates {
  const naive = wallEpochMs(wall);
  const offsets = new Set(PROBE_DELTAS_MS.map((delta) => zoneOffsetMs(new Date(naive + delta), zone)));
  const instants = new Set<number>();
  for (const offset of offsets) {
    const candidate = floorSecond(naive - offset);
    if (wallEpochMs(readWallClock(new Date(candidate), zone)) === naive) instants.add(candidate);
  }
  return { offsets: [...offsets], instants: [...instants].sort((left, right) => left - right) };
}

/** The transition second between the two offsets, or null when the probe window is unusable. */
function transitionMs(wall: WallClock, zone: string, previous: number, next: number): number | null {
  const naive = wallEpochMs(wall);
  const first = floorSecond(naive - previous);
  const second = floorSecond(naive - next);
  let low = Math.min(first, second);
  let high = Math.max(first, second);
  if (zoneOffsetMs(new Date(low), zone) !== previous) return null;
  if (zoneOffsetMs(new Date(high), zone) !== next) return null;
  while (high - low > SECOND_MS) {
    const middle = low + Math.floor((high - low) / (2 * SECOND_MS)) * SECOND_MS;
    if (zoneOffsetMs(new Date(middle), zone) === next) high = middle;
    else low = middle;
  }
  return high;
}

function transitionLabel(wall: WallClock, zone: string, previous: number, next: number, verb: string): string | null {
  const moment = transitionMs(wall, zone, previous, next);
  if (moment === null) return null;
  const from = wallClockTimeLabel(readWallClock(new Date(moment + previous), UTC));
  const to = wallClockTimeLabel(readWallClock(new Date(moment + next), UTC));
  return `${verb} ${from} → ${to}`;
}

/** The wall clock no instant in the zone ever names: the spring-forward gap. */
export class NonexistentZoneTimeError extends Error {
  readonly zone: string;
  readonly value: string;

  constructor(zone: string, value: string, wall: WallClock, jump: string | null) {
    const detail = jump === null ? '' : ` (${jump})`;
    super(`${wallClockTimeLabel(wall)} does not exist in ${zone} on ${wallClockDateLabel(wall)}${detail}`);
    this.name = 'NonexistentZoneTimeError';
    this.zone = zone;
    this.value = value;
  }
}

/** The wall clock two instants in the zone both name: the fall-back repeat, never resolved silently. */
export class AmbiguousZoneTimeError extends Error {
  readonly zone: string;
  readonly value: string;
  readonly instants: readonly Date[];

  constructor(zone: string, value: string, wall: WallClock, instants: readonly Date[], back: string | null) {
    const detail = back === null ? '' : `; ${back}`;
    const when = `${wallClockDateLabel(wall)} (${instants.map(utcInstantLabel).join(' or ')}${detail})`;
    super(`${wallClockTimeLabel(wall)} occurs twice in ${zone} on ${when}`);
    this.name = 'AmbiguousZoneTimeError';
    this.zone = zone;
    this.value = value;
    this.instants = instants;
  }
}

function gapError(value: string, wall: WallClock, zone: string, candidates: ZoneCandidates): NonexistentZoneTimeError {
  const previous = Math.min(...candidates.offsets);
  const next = Math.max(...candidates.offsets);
  const jump = transitionLabel(wall, zone, previous, next, GAP_VERB);
  return new NonexistentZoneTimeError(zone, value, wall, jump);
}

function repeatError(value: string, wall: WallClock, zone: string, candidates: ZoneCandidates): AmbiguousZoneTimeError {
  const previous = Math.max(...candidates.offsets);
  const next = Math.min(...candidates.offsets);
  const back = transitionLabel(wall, zone, previous, next, REPEAT_VERB);
  return new AmbiguousZoneTimeError(zone, value, wall, candidates.instants.map(toInstant), back);
}

/**
 * Convert a `datetime-local` value to the instant that wall clock names in `zone`.
 *
 * Accepts `YYYY-MM-DDTHH:MM` and `YYYY-MM-DDTHH:MM:SS`. A value ending in `Z` already names an
 * instant, so it is passed through rather than re-read as a zone wall clock. Returns null for an
 * empty value and for one that is not a wall clock, which is what a cleared field yields.
 * Throws `NonexistentZoneTimeError` when the wall clock falls in a spring-forward gap and
 * `AmbiguousZoneTimeError` when it falls in a fall-back repeat; both carry the resolved zone.
 * A zone name Intl rejects falls back to the browser zone.
 */
export function zoneWallClockToInstant(value: string, zone: string): Date | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.endsWith('Z') || trimmed.endsWith('z')) {
    const instant = new Date(trimmed);
    return Number.isNaN(instant.getTime()) ? null : instant;
  }
  const wall = parseWallClock(trimmed);
  if (wall === null) return null;
  const target = effectiveZone(zone);
  const candidates = zoneCandidates(wall, target);
  if (candidates.instants.length === 1) return toInstant(candidates.instants[0]);
  if (candidates.instants.length === 0) throw gapError(trimmed, wall, target, candidates);
  throw repeatError(trimmed, wall, target, candidates);
}

/**
 * Render a UTC instant as the `datetime-local` value for `zone`: `YYYY-MM-DDTHH:MM` in local
 * components with no offset suffix. `iso` must be a parseable instant. A zone name Intl rejects
 * falls back to the browser zone.
 */
export function utcToZoneWallClock(iso: string, zone: string): string {
  const wall = readWallClock(new Date(iso), effectiveZone(zone));
  return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}T${wallClockTimeLabel(wall)}`;
}

/**
 * Render a UTC instant for a human reader: `dd/mm/yyyy, HH:MM:SS` in `zone`. Omit `zone` on a page
 * with no contest context and the browser zone is used. `iso` must be a parseable instant, and a
 * zone name Intl rejects falls back to the browser zone.
 */
export function formatInZone(iso: string, zone?: string): string {
  const wall = readWallClock(new Date(iso), effectiveZone(zone ?? ''));
  const date = `${pad2(wall.day)}/${pad2(wall.month)}/${wall.year}`;
  return `${date}, ${wallClockTimeLabel(wall)}:${pad2(wall.second)}`;
}

/**
 * The zone a timestamp should be displayed in: the owner record's zone when the runtime supports
 * it, otherwise the browser zone. Never throws, so a corrupt record falls back to a readable
 * timestamp instead of blanking the page.
 */
export function resolveDisplayZone(ownerZone: string | null | undefined): string {
  if (typeof ownerZone === 'string' && isSupportedZone(ownerZone)) return ownerZone;
  return browserZone();
}