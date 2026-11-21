import { describe, expect, it } from 'vitest';
import {
  AmbiguousZoneTimeError,
  NonexistentZoneTimeError,
  formatInZone,
  formatListMomentInZone,
  resolveDisplayZone,
  utcToZoneWallClock,
  zoneWallClockToInstant,
} from '@/lib/timezone';

const BANGKOK = 'Asia/Bangkok';
const ROME = 'Europe/Rome';
const NEW_YORK = 'America/New_York';
const BROWSER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function toIso(value: string, zone: string): string {
  const instant = zoneWallClockToInstant(value, zone);
  if (instant === null) throw new Error(`expected ${value} in ${zone} to resolve to an instant`);
  return instant.toISOString();
}

describe('zoneWallClockToInstant', () => {
  it('resolves a Bangkok wall clock, a zone that never observes DST', () => {
    expect(toIso('2026-12-31T15:00', BANGKOK)).toBe('2026-12-31T08:00:00.000Z');
  });

  it('accepts a wall clock that carries seconds', () => {
    expect(toIso('2026-12-31T15:00:45', BANGKOK)).toBe('2026-12-31T08:00:45.000Z');
  });

  it('passes a trailing Z through as the instant it already names', () => {
    expect(toIso('2026-12-31T08:00:00Z', BANGKOK)).toBe('2026-12-31T08:00:00.000Z');
  });

  it('applies CET in winter and CEST in summer for Rome', () => {
    expect(toIso('2026-12-31T15:00', ROME)).toBe('2026-12-31T14:00:00.000Z');
    expect(toIso('2026-06-15T12:00', ROME)).toBe('2026-06-15T10:00:00.000Z');
  });

  it('applies EDT for a New York summer wall clock', () => {
    expect(toIso('2026-07-04T12:00', NEW_YORK)).toBe('2026-07-04T16:00:00.000Z');
  });

  it('reports the gap a spring-forward wall clock falls into', () => {
    let thrown: unknown;
    try {
      zoneWallClockToInstant('2026-03-08T02:30', NEW_YORK);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NonexistentZoneTimeError);
    const error = thrown as NonexistentZoneTimeError;
    expect(error.zone).toBe(NEW_YORK);
    expect(error.value).toBe('2026-03-08T02:30');
    expect(error.message).toContain('02:30');
    expect(error.message).toContain(NEW_YORK);
    expect(error.message).toContain('2026-03-08');
    expect(error.message).toContain('02:00');
    expect(error.message).toContain('03:00');
  });

  it('reports both instants a fall-back wall clock repeats', () => {
    let thrown: unknown;
    try {
      zoneWallClockToInstant('2026-11-01T01:30', NEW_YORK);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AmbiguousZoneTimeError);
    const error = thrown as AmbiguousZoneTimeError;
    expect(error.zone).toBe(NEW_YORK);
    expect(error.value).toBe('2026-11-01T01:30');
    expect(error.instants.map((instant) => instant.toISOString())).toEqual([
      '2026-11-01T05:30:00.000Z',
      '2026-11-01T06:30:00.000Z',
    ]);
    expect(error.message).toContain(NEW_YORK);
    expect(error.message).toContain('05:30Z');
    expect(error.message).toContain('06:30Z');
  });

  it('treats an empty value as no time', () => {
    expect(zoneWallClockToInstant('', BANGKOK)).toBeNull();
    expect(zoneWallClockToInstant('   ', BANGKOK)).toBeNull();
  });

  it('falls back to the browser zone for a zone name Intl rejects', () => {
    expect(zoneWallClockToInstant('2026-12-31T15:00', 'Not/AZone')).not.toBeNull();
  });
});

describe('utcToZoneWallClock', () => {
  it('renders a datetime-local value in the given zone', () => {
    expect(utcToZoneWallClock('2026-12-31T08:00:00.000Z', BANGKOK)).toBe('2026-12-31T15:00');
    expect(utcToZoneWallClock('2026-12-31T14:00:00.000Z', ROME)).toBe('2026-12-31T15:00');
    expect(utcToZoneWallClock('2026-07-04T16:00:00.000Z', NEW_YORK)).toBe('2026-07-04T12:00');
  });

  it('round-trips a Bangkok wall clock', () => {
    expect(utcToZoneWallClock('2026-12-31T08:00:00.000Z', BANGKOK)).toBe('2026-12-31T15:00');
    expect(toIso('2026-12-31T15:00', BANGKOK)).toBe('2026-12-31T08:00:00.000Z');
  });

  it('falls back to the browser zone for a zone name Intl rejects', () => {
    expect(utcToZoneWallClock('2026-12-31T08:00:00.000Z', 'Not/AZone')).toBe(
      utcToZoneWallClock('2026-12-31T08:00:00.000Z', BROWSER_ZONE),
    );
  });
});

describe('formatInZone', () => {
  it('renders dd/mm/yyyy, HH:MM:SS in the given zone', () => {
    expect(formatInZone('2026-12-31T08:00:00.000Z', BANGKOK)).toBe('31/12/2026, 15:00:00');
    expect(formatInZone('2026-12-31T14:00:00.000Z', ROME)).toBe('31/12/2026, 15:00:00');
    expect(formatInZone('2026-12-31T14:00:00.000Z')).toBe(
      formatInZone('2026-12-31T14:00:00.000Z', BROWSER_ZONE),
    );
  });

  it('renders a list moment to the minute, with no seconds', () => {
    expect(formatListMomentInZone('2026-12-31T08:00:30.000Z', BANGKOK)).toBe('31/12/2026, 15:00');
    expect(formatListMomentInZone('2026-12-31T08:00:30.000Z', ROME)).toBe('31/12/2026, 09:00');
  });
});

describe('resolveDisplayZone', () => {
  it('keeps a zone Intl supports', () => {
    expect(resolveDisplayZone(ROME)).toBe(ROME);
    expect(resolveDisplayZone(NEW_YORK)).toBe(NEW_YORK);
  });

  it('falls back to the browser zone for a missing owner zone', () => {
    expect(resolveDisplayZone(null)).toBe(BROWSER_ZONE);
    expect(resolveDisplayZone(undefined)).toBe(BROWSER_ZONE);
    expect(resolveDisplayZone('')).toBe(BROWSER_ZONE);
  });

  it('falls back to the browser zone for a zone Intl rejects', () => {
    expect(resolveDisplayZone('Not/AZone')).toBe(BROWSER_ZONE);
  });
});