export type ContestPhase = 'not_started' | 'running' | 'analysis' | 'ended';

export interface ContestTimingWindow {
  start: string | Date | null;
  stop: string | Date | null;
  analysis_start: string | Date | null;
  analysis_stop: string | Date | null;
}

export const DEFAULT_COUNTDOWN_TIMEZONE = 'Asia/Bangkok';

export const PHASE_LABELS: Readonly<Record<ContestPhase, string>> = {
  not_started: 'Not Started',
  running: 'Running',
  analysis: 'Analysis Mode',
  ended: 'Ended',
};

export type CountdownStage = 'waiting' | 'running' | 'analysis' | 'hurry' | 'ended';

export const STAGE_LABELS: Readonly<Record<CountdownStage, string>> = {
  waiting: 'Waiting',
  running: 'Running',
  analysis: 'Analysis',
  hurry: 'Get Ready',
  ended: 'Ended',
};

export type CountdownThresholdUnit = 'seconds' | 'minutes' | 'hours' | 'percent';

export interface CountdownThreshold {
  readonly amount: number;
  readonly unit: CountdownThresholdUnit;
}

export const COUNTDOWN_THRESHOLD_UNITS: readonly CountdownThresholdUnit[] = ['seconds', 'minutes', 'hours', 'percent'];

export const DEFAULT_COUNTDOWN_THRESHOLD: CountdownThreshold = { amount: 5, unit: 'minutes' };

const MILLISECONDS_PER_SECOND = 1_000;
const MILLISECONDS_PER_MINUTE = 60 * MILLISECONDS_PER_SECOND;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;
const PERCENT_DIVISOR = 100;

/** Warning window the threshold means; a percent is measured against the span it is given. */
export function resolveHurryThresholdMs(threshold: CountdownThreshold, windowMs: number): number {
  const amount = Number.isFinite(threshold.amount) && threshold.amount > 0
    ? threshold.amount
    : DEFAULT_COUNTDOWN_THRESHOLD.amount;
  switch (threshold.unit) {
    case 'seconds': return amount * MILLISECONDS_PER_SECOND;
    case 'minutes': return amount * MILLISECONDS_PER_MINUTE;
    case 'hours': return amount * MILLISECONDS_PER_HOUR;
    case 'percent': return (amount / PERCENT_DIVISOR) * windowMs;
  }
}

/** Span a percent threshold scales to: the window the current phase runs across, or the fallback. */
export function countdownPhaseWindowMs(timing: ContestTimingWindow, phase: ContestPhase, fallbackMs: number): number {
  const start = toDate(timing.start);
  const stop = toDate(timing.stop);
  const analysisStart = toDate(timing.analysis_start);
  const analysisStop = toDate(timing.analysis_stop);
  if (phase === 'analysis' && analysisStart && analysisStop) {
    return Math.max(0, analysisStop.getTime() - analysisStart.getTime());
  }
  if (phase !== 'ended' && start && stop) {
    return Math.max(0, stop.getTime() - start.getTime());
  }
  return fallbackMs;
}

/** Hurry once the target is within the window, so both the start and the end earn it. */
export function resolveCountdownStage(phase: ContestPhase, remainingMs: number | null, hurryMs: number): CountdownStage {
  if (phase === 'ended') return 'ended';
  if (phase === 'analysis') return 'analysis';
  const isHurrying = remainingMs !== null && remainingMs <= hurryMs;
  if (phase === 'running') return isHurrying ? 'hurry' : 'running';
  return isHurrying ? 'hurry' : 'waiting';
}

export const RUNNER_MIN_SPEED_PX_PER_SECOND = 110;
export const RUNNER_MAX_SPEED_PX_PER_SECOND = 640;

/**
 * Pace for the running figure: the fuller the window, the slower it moves, and it reaches its
 * top speed as the target arrives. Scaled by the window alone, so the hurry threshold never
 * touches it.
 */
export function resolveRunnerSpeedPxPerSecond(remainingMs: number | null, windowMs: number): number {
  if (remainingMs === null || windowMs <= 0) return RUNNER_MIN_SPEED_PX_PER_SECOND;
  const fullness = Math.min(1, Math.max(0, remainingMs / windowMs));
  const range = RUNNER_MAX_SPEED_PX_PER_SECOND - RUNNER_MIN_SPEED_PX_PER_SECOND;
  return RUNNER_MIN_SPEED_PX_PER_SECOND + range * (1 - fullness);
}

export const RUNNER_STRIDE_SLOW_SECONDS = 0.8;
export const RUNNER_STRIDE_FAST_SECONDS = 0.26;

/** Limb beat for the runner: quicker as the pace quickens, so a fast run does not read as sliding. */
export function resolveRunnerStrideSeconds(speedPxPerSecond: number): number {
  const range = RUNNER_MAX_SPEED_PX_PER_SECOND - RUNNER_MIN_SPEED_PX_PER_SECOND;
  const progress = Math.min(1, Math.max(0, (speedPxPerSecond - RUNNER_MIN_SPEED_PX_PER_SECOND) / range));
  return RUNNER_STRIDE_SLOW_SECONDS + (RUNNER_STRIDE_FAST_SECONDS - RUNNER_STRIDE_SLOW_SECONDS) * progress;
}

// Only reached by a runtime that predates Intl.supportedValuesOf.
const FALLBACK_TIMEZONES: readonly string[] = [
  'UTC',
  'Asia/Bangkok',
  'Asia/Ho_Chi_Minh',
  'Asia/Jakarta',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
];

let cachedTimezones: readonly string[] | null = null;

/** Every IANA zone this runtime ships, so no external timezone database is needed. */
export function listTimezones(): readonly string[] {
  if (cachedTimezones) return cachedTimezones;
  const supportedValuesOf = (Intl as typeof Intl & {
    supportedValuesOf?: (key: 'timeZone') => string[];
  }).supportedValuesOf;
  const zones = typeof supportedValuesOf === 'function' ? supportedValuesOf('timeZone') : [];
  const withUtc = zones.includes('UTC') ? zones : ['UTC', ...zones];
  cachedTimezones = withUtc.length > 1 ? withUtc : FALLBACK_TIMEZONES;
  return cachedTimezones;
}

export function isSupportedTimezone(timeZone: string): boolean {
  return listTimezones().includes(timeZone);
}

let cachedZoneOffsets: ReadonlyMap<string, string> | null = null;

/** Zone to offset label; one formatter per zone, so the map is memoized. */
export function zoneOffsetMap(): ReadonlyMap<string, string> {
  cachedZoneOffsets ??= new Map(listTimezones().map((zone) => [zone, zoneOffsetLabel(zone)]));
  return cachedZoneOffsets;
}

/** No start time means not started, so a contest without one never reads as running. */
export function resolveContestPhase(timing: ContestTimingWindow, now: Date): ContestPhase {
  const start = toDate(timing.start);
  const stop = toDate(timing.stop);
  const analysisStart = toDate(timing.analysis_start);
  const analysisStop = toDate(timing.analysis_stop);
  if (!start || now < start) return 'not_started';
  if (stop && now < stop) return 'running';
  if (analysisStart && analysisStop && now >= analysisStart && now < analysisStop) return 'analysis';
  return 'ended';
}

/** The instant the countdown runs out on for the given phase, or null when none applies. */
export function countdownTarget(timing: ContestTimingWindow, phase: ContestPhase): Date | null {
  switch (phase) {
    case 'not_started': return toDate(timing.start);
    case 'running': return toDate(timing.stop);
    case 'analysis': return toDate(timing.analysis_stop);
    case 'ended': return null;
  }
}

const SECONDS_PER_DAY = 86400;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

/** Only the significant units, so a zero hour is dropped rather than shown as 00. */
function countdownRuns(totalSeconds: number): readonly string[] {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const days = Math.floor(totalSeconds / SECONDS_PER_DAY);
  const hours = Math.floor((totalSeconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  if (days > 0) return [`${days}d`, `${pad(hours)}:`, `${pad(minutes)}:`, pad(seconds)];
  if (hours > 0) return [`${pad(hours)}:`, `${pad(minutes)}:`, pad(seconds)];
  if (minutes > 0) return [`${pad(minutes)}:`, pad(seconds)];
  return [pad(seconds)];
}

export interface CountdownGlyph {
  readonly char: string;
  /** Position in the whole countdown, so a changed digit keys a new element. */
  readonly index: number;
}

export interface CountdownSegment {
  readonly glyphs: readonly CountdownGlyph[];
}

/** Breakable points only: between number groups, never inside one, and no zero leading unit. */
export function toCountdownSegments(totalMs: number): readonly CountdownSegment[] {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  let index = 0;
  return countdownRuns(totalSeconds).map((run) => ({
    glyphs: [...run].map((char) => ({ char, index: index++ })),
  }));
}

export const COUNTDOWN_BASE_FONT_PX = 100;
export const COUNTDOWN_MIN_FONT_PX = 16;
export const COUNTDOWN_MAX_FONT_PX = 480;

/** Font size at which content measured at the base size fills the box on both axes. */
export function fitCountdownFontPx(params: {
  availableWidth: number;
  availableHeight: number;
  naturalWidth: number;
  naturalHeight: number;
}): number {
  const { availableWidth, availableHeight, naturalWidth, naturalHeight } = params;
  if (naturalWidth <= 0 || naturalHeight <= 0) return COUNTDOWN_BASE_FONT_PX;
  const scale = Math.min(availableWidth / naturalWidth, availableHeight / naturalHeight);
  if (!Number.isFinite(scale) || scale <= 0) return COUNTDOWN_BASE_FONT_PX;
  return Math.min(COUNTDOWN_MAX_FONT_PX, Math.max(COUNTDOWN_MIN_FONT_PX, COUNTDOWN_BASE_FONT_PX * scale));
}

export function formatZoneTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function zoneOffsetLabel(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(new Date());
  const offset = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
  return offset.replace('GMT', 'UTC');
}

function toDate(value: string | Date | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
