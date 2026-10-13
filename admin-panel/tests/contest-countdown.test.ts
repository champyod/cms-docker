import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_BASE_FONT_PX,
  COUNTDOWN_FILL_RATIO,
  COUNTDOWN_FIT_MARGIN_RATIO,
  COUNTDOWN_MAX_FONT_PX,
  isCountdownDigit,
  COUNTDOWN_MIN_FONT_PX,
  DEFAULT_COUNTDOWN_THRESHOLD,
  countdownPhaseWindowMs,
  countdownTarget,
  fitCountdownFontPx,
  formatZoneClockHHMM,
  formatZoneClockHMS,
  formatZoneTime,
  formatZoneTimeTitle,
  toZoneClockSamples,
  isSupportedTimezone,
  listTimezones,
  resolveContestPhase,
  resolveCountdownStage,
  resolveHurryThresholdMs,
  toCountdownSegments,
  zoneOffsetLabel,
  zoneOffsetMap,
} from '@/lib/contest-countdown';
import {
  parseCountdownThreshold,
  serializeCountdownThreshold,
} from '@/components/contests/contest-detail/useContestCountdown';

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
  it('sizes the content to the configured share of the box, not the whole box', () => {
    const fitted = fitCountdownFontPx({ availableWidth: 400, availableHeight: 100, naturalWidth: 400, naturalHeight: 100 });
    expect(fitted).toBe(COUNTDOWN_BASE_FONT_PX * COUNTDOWN_FILL_RATIO);
    expect(COUNTDOWN_FILL_RATIO).toBe(0.9);
  });

  it('leaves the remainder as breathing room around the content', () => {
    expect(COUNTDOWN_FIT_MARGIN_RATIO).toBeCloseTo(0.1, 10);
    expect(COUNTDOWN_FILL_RATIO + COUNTDOWN_FIT_MARGIN_RATIO).toBeCloseTo(1, 10);
  });

  it('scales down to the tighter axis', () => {
    expect(fitCountdownFontPx({ availableWidth: 200, availableHeight: 100, naturalWidth: 400, naturalHeight: 100 }))
      .toBe((COUNTDOWN_BASE_FONT_PX * COUNTDOWN_FILL_RATIO) / 2);
  });

  it('scales up to fill a larger box', () => {
    expect(fitCountdownFontPx({ availableWidth: 800, availableHeight: 200, naturalWidth: 400, naturalHeight: 100 }))
      .toBe(COUNTDOWN_BASE_FONT_PX * 2 * COUNTDOWN_FILL_RATIO);
  });

  it('can be told a different share, so the fill stays a parameter', () => {
    const tight = fitCountdownFontPx({ availableWidth: 400, availableHeight: 400, naturalWidth: 400, naturalHeight: 100, fillRatio: 0.5 });
    const loose = fitCountdownFontPx({ availableWidth: 400, availableHeight: 400, naturalWidth: 400, naturalHeight: 100, fillRatio: 0.9 });
    expect(loose).toBeGreaterThan(tight);
  });

  it('refuses an unusable share rather than emitting a broken size', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const fitted = fitCountdownFontPx({
        availableWidth: 400, availableHeight: 400, naturalWidth: 400, naturalHeight: 100, fillRatio: bad,
      });
      expect(Number.isFinite(fitted)).toBe(true);
      expect(fitted).toBeGreaterThan(0);
    }
  });

  it('never exceeds the whole box, however large the share asked for', () => {
    const whole = fitCountdownFontPx({ availableWidth: 400, availableHeight: 400, naturalWidth: 400, naturalHeight: 100, fillRatio: 1 });
    const over = fitCountdownFontPx({ availableWidth: 400, availableHeight: 400, naturalWidth: 400, naturalHeight: 100, fillRatio: 9 });
    expect(over).toBe(whole);
  });

  it('clamps to the readable range', () => {
    expect(fitCountdownFontPx({ availableWidth: 40, availableHeight: 10, naturalWidth: 4000, naturalHeight: 1000 }))
      .toBe(COUNTDOWN_MIN_FONT_PX);
    expect(fitCountdownFontPx({ availableWidth: 40_000, availableHeight: 10_000, naturalWidth: 40, naturalHeight: 10 }))
      .toBe(COUNTDOWN_MAX_FONT_PX);
  });

  it('reaches well past the old ceiling, so a large screen is not left with small digits', () => {
    expect(COUNTDOWN_MAX_FONT_PX).toBeGreaterThanOrEqual(900);
  });

  it('falls back to the base size when there is nothing to measure', () => {
    expect(fitCountdownFontPx({ availableWidth: 400, availableHeight: 100, naturalWidth: 0, naturalHeight: 0 }))
      .toBe(COUNTDOWN_BASE_FONT_PX);
  });
});

describe('isCountdownDigit', () => {
  it('accepts every numeral', () => {
    for (const char of '0123456789') expect(isCountdownDigit(char)).toBe(true);
  });

  it('rejects the separators a countdown contains', () => {
    for (const char of [':', 'd', ' ', '-', '—']) expect(isCountdownDigit(char)).toBe(false);
  });

  it('rejects anything that is not a single character', () => {
    expect(isCountdownDigit('12')).toBe(false);
    expect(isCountdownDigit('')).toBe(false);
  });

  it('separates exactly the numerals the clock draws, so only those take a fixed slot', () => {
    const segments = toCountdownSegments(3_723_000);
    const glyphs = segments.flatMap((segment) => segment.glyphs.map((glyph) => glyph.char));
    const digits = glyphs.filter(isCountdownDigit);
    const separators = glyphs.filter((char) => !isCountdownDigit(char));
    expect(digits.length).toBeGreaterThan(0);
    expect(separators).toContain(':');
    expect(digits.length + separators.length).toBe(glyphs.length);
  });
});

describe('timezone helpers', () => {
  it('labels the Bangkok offset as UTC+7', () => {
    expect(zoneOffsetLabel('Asia/Bangkok')).toBe('UTC+07:00');
  });

  it('lists the full zone set the runtime knows, including the default and UTC', () => {
    const zones = listTimezones();
    expect(zones.length).toBeGreaterThan(50);
    expect(zones).toContain('UTC');
    expect(zones).toContain('Asia/Bangkok');
  });

  it('answers support for a known zone and rejects an unknown one', () => {
    expect(isSupportedTimezone('Asia/Bangkok')).toBe(true);
    expect(isSupportedTimezone('Not/AZone')).toBe(false);
  });

  it('maps every listed zone to an offset label', () => {
    const offsets = zoneOffsetMap();
    const zones = listTimezones();
    expect(offsets.size).toBe(zones.length);
    expect(offsets.get('Asia/Bangkok')).toBe('UTC+07:00');
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

describe('formatZoneClockHHMM', () => {
  it('renders only a zero-padded HH:MM, with no date or seconds', () => {
    const clock = formatZoneClockHHMM(new Date('2026-01-01T08:07:09Z'), 'UTC');
    expect(clock).toBe('08:07');
    expect(clock).toMatch(/^\d{2}:\d{2}$/);
  });

  it('reads midnight as 00:00 rather than 12:00 or 24:00', () => {
    expect(formatZoneClockHHMM(new Date('2026-01-01T00:00:00Z'), 'UTC')).toBe('00:00');
    expect(formatZoneClockHHMM(new Date('2026-01-01T23:59:59Z'), 'UTC')).toBe('23:59');
  });

  it('reads noon as 12:00, so the clock never exceeds 23:59', () => {
    expect(formatZoneClockHHMM(new Date('2026-01-01T12:00:00Z'), 'UTC')).toBe('12:00');
    expect(formatZoneClockHHMM(new Date('2026-01-01T13:00:00Z'), 'UTC')).toBe('13:00');
  });

  it('crosses midnight in a zone ahead of UTC without borrowing the previous day hour', () => {
    expect(formatZoneClockHHMM(new Date('2026-01-01T17:00:00Z'), 'Asia/Bangkok')).toBe('00:00');
    expect(formatZoneClockHHMM(new Date('2026-01-01T16:59:59Z'), 'Asia/Bangkok')).toBe('23:59');
  });

  it('crosses midnight backwards in a zone behind UTC', () => {
    expect(formatZoneClockHHMM(new Date('2026-01-02T04:59:00Z'), 'America/New_York')).toBe('23:59');
    expect(formatZoneClockHHMM(new Date('2026-01-02T05:00:00Z'), 'America/New_York')).toBe('00:00');
  });

  it('carries a half-hour offset into the minutes', () => {
    expect(formatZoneClockHHMM(new Date('2026-01-01T00:00:00Z'), 'Asia/Kolkata')).toBe('05:30');
  });

  it('agrees with the full zone time on the clock it carries', () => {
    const instant = new Date('2026-03-05T09:41:00Z');
    for (const zone of ['UTC', 'Asia/Bangkok', 'Asia/Kolkata', 'America/New_York', 'Pacific/Auckland']) {
      const full = formatZoneTime(instant, zone);
      expect(full).toContain(formatZoneClockHHMM(instant, zone));
    }
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

describe('countdown threshold store', () => {
  it('reads a cleared field back as empty instead of the default amount', () => {
    const cleared = parseCountdownThreshold(serializeCountdownThreshold({ amount: Number.NaN, unit: 'minutes' }));
    expect(Number.isFinite(cleared.amount)).toBe(false);
    expect(Number.isFinite(cleared.amount) ? String(cleared.amount) : '').toBe('');
    expect(cleared.unit).toBe('minutes');
  });

  it('keeps warning five minutes ahead while the field is cleared', () => {
    const cleared = parseCountdownThreshold(serializeCountdownThreshold({ amount: Number.NaN, unit: 'minutes' }));
    expect(resolveHurryThresholdMs(cleared, 0)).toBe(5 * 60 * 1000);
  });

  it('reads a stored amount back unchanged', () => {
    expect(parseCountdownThreshold(serializeCountdownThreshold({ amount: 30, unit: 'seconds' })))
      .toEqual({ amount: 30, unit: 'seconds' });
  });

  it('falls back to the default for a payload that is absent or unusable', () => {
    for (const raw of [null, '', 'not json', '"10"', '{"amount":10}', '{"amount":"10","unit":"minutes"}', '{"amount":null,"unit":"weeks"}']) {
      expect(parseCountdownThreshold(raw)).toEqual(DEFAULT_COUNTDOWN_THRESHOLD);
    }
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

describe('formatZoneClockHMS', () => {
  it('renders a zero-padded HH:MM:SS', () => {
    const clock = formatZoneClockHMS(new Date('2026-01-01T08:07:09Z'), 'UTC');
    expect(clock).toBe('08:07:09');
    expect(clock).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('rolls the seconds rather than the minutes while they tick', () => {
    expect(formatZoneClockHMS(new Date('2026-01-01T08:07:59Z'), 'UTC')).toBe('08:07:59');
    expect(formatZoneClockHMS(new Date('2026-01-01T08:08:00Z'), 'UTC')).toBe('08:08:00');
  });

  it('reads midnight as 00:00:00 rather than 12 or 24', () => {
    expect(formatZoneClockHMS(new Date('2026-01-01T00:00:00Z'), 'UTC')).toBe('00:00:00');
  });

  it('agrees with the minute clock on the minute it carries', () => {
    const instant = new Date('2026-03-05T09:41:37Z');
    for (const zone of ['UTC', 'Asia/Bangkok', 'Asia/Kolkata', 'America/New_York', 'Pacific/Auckland']) {
      expect(formatZoneClockHMS(instant, zone)).toContain(formatZoneClockHHMM(instant, zone));
    }
  });

  it('carries a half-hour offset into the minutes', () => {
    expect(formatZoneClockHMS(new Date('2026-01-01T00:00:00Z'), 'Asia/Kolkata')).toBe('05:30:00');
  });
});

describe('formatZoneTimeTitle', () => {
  it('names both the zoned reading and the zone it was read in', () => {
    const title = formatZoneTimeTitle(new Date('2026-01-01T08:07:09Z'), 'Asia/Bangkok');
    expect(title).toContain('Jan');
    expect(title).toContain('15:07:09');
    expect(title).toContain('(Asia/Bangkok)');
  });
});

describe('toZoneClockSamples', () => {
  it('splits the clock into one entry per character', () => {
    const samples = toZoneClockSamples(new Date('2026-01-01T08:07:09Z'), 'UTC');
    expect(samples).toHaveLength('08:07:09'.length);
    expect(samples.join('')).toBe('08:07:09');
  });
});
