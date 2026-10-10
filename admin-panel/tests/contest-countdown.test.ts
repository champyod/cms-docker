import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_TIMEZONES,
  DEFAULT_COUNTDOWN_TIMEZONE,
  countdownTarget,
  formatCountdown,
  formatZoneTime,
  resolveContestPhase,
  zoneOffsetLabel,
} from '@/lib/contest-countdown';

const START = '2026-10-10T10:00:00Z';
const STOP = '2026-10-10T18:00:00Z';
const ANALYSIS_START = '2026-10-10T18:00:00Z';
const ANALYSIS_STOP = '2026-10-10T20:00:00Z';

function timing(overrides: Partial<{
  start: string | null;
  stop: string | null;
  analysis_start: string | null;
  analysis_stop: string | null;
}> = {}) {
  return {
    start: START,
    stop: STOP,
    analysis_start: ANALYSIS_START,
    analysis_stop: ANALYSIS_STOP,
    ...overrides,
  };
}

describe('resolveContestPhase', () => {
  it('marks the contest not started before its start time', () => {
    expect(resolveContestPhase(timing(), new Date('2026-10-10T09:59:59Z'))).toBe('not_started');
  });

  it('marks the contest not started when no start time is configured', () => {
    expect(resolveContestPhase(timing({ start: null }), new Date('2026-10-10T12:00:00Z'))).toBe('not_started');
  });

  it('marks the contest running between start and stop', () => {
    expect(resolveContestPhase(timing(), new Date('2026-10-10T12:00:00Z'))).toBe('running');
  });

  it('marks analysis mode inside the analysis window', () => {
    expect(resolveContestPhase(timing(), new Date('2026-10-10T19:00:00Z'))).toBe('analysis');
  });

  it('marks the contest ended after every window closes', () => {
    expect(resolveContestPhase(timing(), new Date('2026-10-10T20:00:00Z'))).toBe('ended');
    expect(resolveContestPhase(timing(), new Date('2026-10-11T10:00:00Z'))).toBe('ended');
  });
});

describe('countdownTarget', () => {
  it('counts down to the start before the contest', () => {
    const target = countdownTarget(timing(), 'not_started');
    expect(target?.toISOString()).toBe(new Date(START).toISOString());
  });

  it('counts down to the stop while running', () => {
    const target = countdownTarget(timing(), 'running');
    expect(target?.toISOString()).toBe(new Date(STOP).toISOString());
  });

  it('counts down to the analysis stop during analysis', () => {
    const target = countdownTarget(timing(), 'analysis');
    expect(target?.toISOString()).toBe(new Date(ANALYSIS_STOP).toISOString());
  });

  it('has no target once ended', () => {
    expect(countdownTarget(timing(), 'ended')).toBeNull();
  });

  it('has no target when the phase target is unconfigured', () => {
    expect(countdownTarget(timing({ stop: null }), 'running')).toBeNull();
  });
});

describe('formatCountdown', () => {
  it('renders hours, minutes, and seconds with padding', () => {
    expect(formatCountdown(4 * 3600 * 1000 + 11 * 60 * 1000 + 9 * 1000)).toBe('04:11:09');
    expect(formatCountdown(5 * 1000)).toBe('00:00:05');
  });

  it('prefixes days once the span reaches one', () => {
    expect(formatCountdown(26 * 3600 * 1000)).toBe('1d 02:00:00');
  });

  it('clamps negative spans to zero', () => {
    expect(formatCountdown(-5000)).toBe('00:00:00');
  });
});

describe('timezone helpers', () => {
  it('defaults to UTC+7', () => {
    expect(DEFAULT_COUNTDOWN_TIMEZONE).toBe('Asia/Bangkok');
    expect(COUNTDOWN_TIMEZONES[0]).toBe(DEFAULT_COUNTDOWN_TIMEZONE);
    expect(zoneOffsetLabel(DEFAULT_COUNTDOWN_TIMEZONE)).toBe('UTC+07:00');
  });

  it('lists only IANA zones and UTC', () => {
    for (const zone of COUNTDOWN_TIMEZONES) {
      expect(() => zoneOffsetLabel(zone)).not.toThrow();
    }
  });

  it('renders a zone time deterministically for UTC', () => {
    expect(formatZoneTime(new Date('2026-01-01T00:00:00Z'), 'UTC')).toContain('01 Jan 2026');
    expect(formatZoneTime(new Date('2026-01-01T00:00:00Z'), 'UTC')).toContain('00:00:00');
  });

  it('shifts the rendered hour by the zone offset', () => {
    const bangkok = formatZoneTime(new Date('2026-01-01T00:00:00Z'), 'Asia/Bangkok');
    expect(bangkok).toContain('07:00:00');
  });
});
