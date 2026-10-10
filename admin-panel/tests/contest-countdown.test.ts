import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_BASE_FONT_PX,
  COUNTDOWN_MAX_FONT_PX,
  COUNTDOWN_MIN_FONT_PX,
  DEFAULT_COUNTDOWN_THRESHOLD,
  DEFAULT_COUNTDOWN_TIMEZONE,
  countdownPhaseWindowMs,
  countdownTarget,
  fitCountdownFontPx,
  formatZoneTime,
  isSupportedTimezone,
  listTimezones,
  resolveContestPhase,
  resolveCountdownStage,
  resolveHurryThresholdMs,
  toCountdownSegments,
  zoneOffsetLabel,
  zoneOffsetMap,
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

describe('toCountdownSegments', () => {
  it('splits the clock into one segment per number group', () => {
    const segments = toCountdownSegments(4 * 3600 * 1000 + 11 * 60 * 1000 + 9 * 1000);
    expect(segments.map((segment) => segment.glyphs.map((glyph) => glyph.char).join('')))
      .toEqual(['04:', '11:', '09']);
  });

  it('drops a zero leading unit instead of showing it', () => {
    expect(toCountdownSegments(11 * 60 * 1000 + 9 * 1000).map((segment) => segment.glyphs.map((glyph) => glyph.char).join('')))
      .toEqual(['11:', '09']);
    expect(toCountdownSegments(9 * 1000).map((segment) => segment.glyphs.map((glyph) => glyph.char).join('')))
      .toEqual(['09']);
  });

  it('prefixes a day segment once the span reaches one', () => {
    const segments = toCountdownSegments(26 * 3600 * 1000);
    expect(segments.map((segment) => segment.glyphs.map((glyph) => glyph.char).join('')))
      .toEqual(['1d', '02:', '00:', '00']);
  });

  it('ends every segment on its separator so a wrap never leads with a colon', () => {
    for (const totalMs of [5 * 1000, 4 * 3600 * 1000, 50 * 3600 * 1000, 200 * 3600 * 1000]) {
      for (const segment of toCountdownSegments(totalMs)) {
        const text = segment.glyphs.map((glyph) => glyph.char).join('');
        expect(text.startsWith(':')).toBe(false);
      }
    }
  });

  it('numbers every glyph by its position in the whole countdown', () => {
    const segments = toCountdownSegments(4 * 3600 * 1000);
    const indices = segments.flatMap((segment) => segment.glyphs.map((glyph) => glyph.index));
    expect(indices).toEqual(indices.map((_, position) => position));
  });
});

describe('fitCountdownFontPx', () => {
  it('keeps the base size when the box matches the content', () => {
    expect(fitCountdownFontPx({ availableWidth: 400, availableHeight: 100, naturalWidth: 400, naturalHeight: 100 }))
      .toBe(COUNTDOWN_BASE_FONT_PX);
  });

  it('scales down to the tighter axis', () => {
    expect(fitCountdownFontPx({ availableWidth: 200, availableHeight: 100, naturalWidth: 400, naturalHeight: 100 }))
      .toBe(COUNTDOWN_BASE_FONT_PX / 2);
  });

  it('scales up to fill a larger box', () => {
    expect(fitCountdownFontPx({ availableWidth: 800, availableHeight: 200, naturalWidth: 400, naturalHeight: 100 }))
      .toBe(COUNTDOWN_BASE_FONT_PX * 2);
  });

  it('clamps to the readable range', () => {
    expect(fitCountdownFontPx({ availableWidth: 40, availableHeight: 10, naturalWidth: 4000, naturalHeight: 1000 }))
      .toBe(COUNTDOWN_MIN_FONT_PX);
    expect(fitCountdownFontPx({ availableWidth: 40_000, availableHeight: 10_000, naturalWidth: 40, naturalHeight: 10 }))
      .toBe(COUNTDOWN_MAX_FONT_PX);
  });

  it('falls back to the base size when there is nothing to measure', () => {
    expect(fitCountdownFontPx({ availableWidth: 400, availableHeight: 100, naturalWidth: 0, naturalHeight: 0 }))
      .toBe(COUNTDOWN_BASE_FONT_PX);
  });
});

describe('timezone helpers', () => {
  it('defaults to UTC+7', () => {
    expect(DEFAULT_COUNTDOWN_TIMEZONE).toBe('Asia/Bangkok');
    expect(zoneOffsetLabel(DEFAULT_COUNTDOWN_TIMEZONE)).toBe('UTC+07:00');
  });

  it('lists the full zone set the runtime knows, including the default and UTC', () => {
    const zones = listTimezones();
    expect(zones.length).toBeGreaterThan(50);
    expect(zones).toContain('UTC');
    expect(zones).toContain(DEFAULT_COUNTDOWN_TIMEZONE);
  });

  it('answers support for a known zone and rejects an unknown one', () => {
    expect(isSupportedTimezone('Asia/Bangkok')).toBe(true);
    expect(isSupportedTimezone('Not/AZone')).toBe(false);
  });

  it('maps every listed zone to an offset label', () => {
    const offsets = zoneOffsetMap();
    const zones = listTimezones();
    expect(offsets.size).toBe(zones.length);
    expect(offsets.get(DEFAULT_COUNTDOWN_TIMEZONE)).toBe('UTC+07:00');
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

describe('resolveCountdownStage', () => {
  const HURRY_MS = 60_000;

  it('hurries within the window before the start', () => {
    expect(resolveCountdownStage('not_started', 59_000, HURRY_MS)).toBe('hurry');
    expect(resolveCountdownStage('not_started', 61_000, HURRY_MS)).toBe('waiting');
  });

  it('hurries within the window before the end', () => {
    expect(resolveCountdownStage('running', 30_000, HURRY_MS)).toBe('hurry');
    expect(resolveCountdownStage('running', 90_000, HURRY_MS)).toBe('running');
  });

  it('keeps analysis and ended off the hurry path', () => {
    expect(resolveCountdownStage('analysis', 5_000, HURRY_MS)).toBe('analysis');
    expect(resolveCountdownStage('ended', 0, HURRY_MS)).toBe('ended');
  });

  it('stays calm when there is no target to run out', () => {
    expect(resolveCountdownStage('not_started', null, HURRY_MS)).toBe('waiting');
    expect(resolveCountdownStage('running', null, HURRY_MS)).toBe('running');
  });
});

describe('resolveHurryThresholdMs', () => {
  it('scales each fixed unit to milliseconds', () => {
    expect(resolveHurryThresholdMs({ amount: 30, unit: 'seconds' }, 0)).toBe(30_000);
    expect(resolveHurryThresholdMs({ amount: 5, unit: 'minutes' }, 0)).toBe(300_000);
    expect(resolveHurryThresholdMs({ amount: 2, unit: 'hours' }, 0)).toBe(7_200_000);
  });

  it('measures a percent against the window it is given', () => {
    expect(resolveHurryThresholdMs({ amount: 5, unit: 'percent' }, 3_600_000)).toBe(180_000);
  });

  it('falls back to the default amount for a cleared or invalid value', () => {
    const fallback = resolveHurryThresholdMs(DEFAULT_COUNTDOWN_THRESHOLD, 0);
    expect(resolveHurryThresholdMs({ amount: 0, unit: 'minutes' }, 0)).toBe(fallback);
    expect(resolveHurryThresholdMs({ amount: Number.NaN, unit: 'minutes' }, 0)).toBe(fallback);
  });
});

describe('countdownPhaseWindowMs', () => {
  it('uses the contest span while running', () => {
    expect(countdownPhaseWindowMs(timing(), 'running', 1)).toBe(8 * 3_600_000);
  });

  it('uses the analysis span during analysis', () => {
    expect(countdownPhaseWindowMs(timing(), 'analysis', 1)).toBe(2 * 3_600_000);
  });

  it('falls back when the columns a phase needs are absent', () => {
    expect(countdownPhaseWindowMs(timing({ stop: null }), 'running', 1234)).toBe(1234);
    expect(countdownPhaseWindowMs(timing(), 'ended', 1234)).toBe(1234);
  });
});
