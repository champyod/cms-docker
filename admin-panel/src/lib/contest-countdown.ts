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

export const COUNTDOWN_TIMEZONES: readonly string[] = listTimezones();

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

/** `HH:MM:SS`, prefixed with the day count once the span reaches one. */
export function formatCountdown(totalMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const days = Math.floor(totalSeconds / SECONDS_PER_DAY);
  const hours = Math.floor((totalSeconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  const pad = (value: number): string => String(value).padStart(2, '0');
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

export interface CountdownGlyph {
  readonly char: string;
  /** Position in the whole countdown, so a changed digit keys a new element. */
  readonly index: number;
}

export interface CountdownSegment {
  readonly glyphs: readonly CountdownGlyph[];
}

/** Splits the countdown at the only breakable points: between number groups, never inside one. */
export function toCountdownSegments(totalMs: number): readonly CountdownSegment[] {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const days = Math.floor(totalSeconds / SECONDS_PER_DAY);
  const hours = Math.floor((totalSeconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  const pad = (value: number): string => String(value).padStart(2, '0');
  const runs = days > 0
    ? [`${days}d`, `${pad(hours)}:`, `${pad(minutes)}:`, pad(seconds)]
    : [`${pad(hours)}:`, `${pad(minutes)}:`, pad(seconds)];

  let index = 0;
  return runs.map((run) => ({
    glyphs: [...run].map((char) => ({ char, index: index++ })),
  }));
}

export const COUNTDOWN_BASE_FONT_PX = 100;
export const COUNTDOWN_MIN_FONT_PX = 16;
export const COUNTDOWN_MAX_FONT_PX = 360;

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
