// Why: the countdown tab derives every displayed value from the same
// four timing columns the overview edits, so the derivations live here
// as pure functions — unit-testable without a browser, and shared with
// the overview status card so the two surfaces cannot disagree.

export type ContestPhase = 'not_started' | 'running' | 'analysis' | 'ended';

export interface ContestTimingWindow {
  start: string | Date | null;
  stop: string | Date | null;
  analysis_start: string | Date | null;
  analysis_stop: string | Date | null;
}

export const DEFAULT_COUNTDOWN_TIMEZONE = 'Asia/Bangkok';

// Why: a fixed picker list keeps the selector predictable for admins;
// each entry is an IANA zone so Intl renders DST-correct offsets.
export const COUNTDOWN_TIMEZONES: readonly string[] = [
  'Asia/Bangkok',
  'Asia/Ho_Chi_Minh',
  'Asia/Jakarta',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'Europe/Moscow',
  'Europe/Berlin',
  'Europe/London',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'UTC',
];

export const PHASE_LABELS: Readonly<Record<ContestPhase, string>> = {
  not_started: 'Not Started',
  running: 'Running',
  analysis: 'Analysis Mode',
  ended: 'Ended',
};

/** Mirrors the overview status card: no start means not started yet. */
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

/** The instant the countdown runs out on: start before the contest, stop while running. */
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

/** Renders a remaining span as `HH:MM:SS`, prefixing days once it reaches one. */
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

/** Renders an instant as a readable timestamp inside the chosen zone. */
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

/** Renders a zone's current offset, e.g. `UTC+07:00` for Asia/Bangkok. */
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
