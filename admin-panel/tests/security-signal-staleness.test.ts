import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_STALE_WINDOW_HOURS,
  parseStalenessPayload,
  readStalenessSnapshot,
  stalenessOptionsFromEnv,
  STALENESS_QUERY,
} from '@/lib/security/staleness';

const NOW = new Date('2026-10-25T12:00:00.000Z');
const NOW_SECONDS = NOW.getTime() / 1000;
const WINDOW = { staleWindowHours: DEFAULT_STALE_WINDOW_HOURS };

function vector(samples: readonly { name: string; value: number; at?: number }[]): unknown {
  return {
    status: 'success',
    data: {
      resultType: 'vector',
      result: samples.map((sample) => ({
        metric: { __name__: sample.name },
        value: [sample.at ?? NOW_SECONDS, String(sample.value)],
      })),
    },
  };
}

/** A healthy publisher: wrote four hours ago, both verdicts 0, both ages real. */
function healthy(): unknown {
  return vector([
    { name: 'cms_backup_metrics_written_timestamp_seconds', value: NOW_SECONDS - 4 * 3600 },
    { name: 'cms_backup_stale', value: 0 },
    { name: 'cms_backup_last_success_age_seconds', value: 3.5 * 3600 },
    { name: 'cms_offsite_stale', value: 0 },
    { name: 'cms_offsite_last_ship_age_seconds', value: 4 * 3600 },
  ]);
}

describe('backup staleness reading', () => {
  it('reads the publishers verdict instead of computing its own', () => {
    const snapshot = parseStalenessPayload(healthy(), NOW, WINDOW, 'http://prometheus:9090');

    expect(snapshot.source).toBe('http://prometheus:9090');
    expect(snapshot.readings.map((reading) => reading.state)).toEqual(['current', 'current']);
    expect(snapshot.readings[0]?.ageSeconds).toBe(3.5 * 3600);
    // The query names the series it needs and nothing else: a second request would let the two
    // channels describe different instants.
    expect(STALENESS_QUERY).toContain('cms_backup_stale');
    expect(STALENESS_QUERY).toContain('cms_offsite_stale');
    expect(STALENESS_QUERY).toContain('cms_backup_metrics_written_timestamp_seconds');
  });

  it('reports a stale verdict with the hours the publisher named', () => {
    const payload = vector([
      { name: 'cms_backup_metrics_written_timestamp_seconds', value: NOW_SECONDS - 3600 },
      { name: 'cms_backup_stale', value: 1 },
      { name: 'cms_backup_last_success_age_seconds', value: 40 * 3600 },
      { name: 'cms_offsite_stale', value: 0 },
      { name: 'cms_offsite_last_ship_age_seconds', value: 2 * 3600 },
    ]);

    const snapshot = parseStalenessPayload(payload, NOW, WINDOW, null);

    expect(snapshot.readings[0]?.state).toBe('stale');
    expect(snapshot.readings[0]?.detail).toContain('40h old');
    expect(snapshot.readings[0]?.detail).toContain(`${String(DEFAULT_STALE_WINDOW_HOURS)}h`);
    expect(snapshot.readings[1]?.state).toBe('current');
  });

  it('reports one missing channel as unreadable rather than borrowing the other verdict', () => {
    const payload = vector([
      { name: 'cms_backup_metrics_written_timestamp_seconds', value: NOW_SECONDS - 3600 },
      { name: 'cms_backup_stale', value: 0 },
      { name: 'cms_backup_last_success_age_seconds', value: 3600 },
    ]);

    const snapshot = parseStalenessPayload(payload, NOW, WINDOW, null);

    expect(snapshot.readings[0]?.state).toBe('current');
    expect(snapshot.readings[1]?.state).toBe('unknown');
    expect(snapshot.readings[1]?.detail).toContain('no cms_offsite_stale series');
  });

  it('stops trusting a "not stale" verdict once the publisher has stopped writing', () => {
    // The file was written 40h ago and certified a fresh backup then. Its own window is 26h, so
    // nothing has published inside the window it describes — the verdict describes the past.
    const payload = vector([
      { name: 'cms_backup_metrics_written_timestamp_seconds', value: NOW_SECONDS - 40 * 3600 },
      { name: 'cms_backup_stale', value: 0 },
      { name: 'cms_backup_last_success_age_seconds', value: 3600 },
      { name: 'cms_offsite_stale', value: 0 },
      { name: 'cms_offsite_last_ship_age_seconds', value: 3600 },
    ]);

    const snapshot = parseStalenessPayload(payload, NOW, WINDOW, null);

    expect(snapshot.readings.map((reading) => reading.state)).toEqual(['unknown', 'unknown']);
    expect(snapshot.readings[0]?.detail).toContain('last wrote 40h ago');
    expect(snapshot.readings[0]?.detail).toContain('describes that moment');
  });

  it('still believes a stale verdict from a dead publisher, because age only grows', () => {
    const payload = vector([
      { name: 'cms_backup_metrics_written_timestamp_seconds', value: NOW_SECONDS - 40 * 3600 },
      { name: 'cms_backup_stale', value: 1 },
      { name: 'cms_backup_last_success_age_seconds', value: 30 * 3600 },
    ]);

    const snapshot = parseStalenessPayload(payload, NOW, WINDOW, null);
    expect(snapshot.readings[0]?.state).toBe('stale');
  });

  it('reports nothing readable as unknown, for every shape of a failed query', () => {
    for (const payload of [{ status: 'error' }, { status: 'success' }, null, 'text']) {
      const snapshot = parseStalenessPayload(payload, NOW, WINDOW, null);
      expect(snapshot.readings.map((reading) => reading.state)).toEqual(['unknown', 'unknown']);
    }
  });

  describe('reading over HTTP', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns unknown when the scrape target is unreachable', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('getaddrinfo ENOTFOUND prometheus'))));

      const snapshot = await readStalenessSnapshot(NOW, { baseUrl: 'http://prometheus:9090', timeoutMs: 50, staleWindowHours: 26 });

      expect(snapshot.readings.map((reading) => reading.state)).toEqual(['unknown', 'unknown']);
      expect(snapshot.readings[0]?.detail).toContain('not reachable');
    });

    it('returns unknown on a non-2xx answer', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));

      const snapshot = await readStalenessSnapshot(NOW, { baseUrl: 'http://prometheus:9090', timeoutMs: 50, staleWindowHours: 26 });

      expect(snapshot.readings[0]?.detail).toContain('503');
    });

    it('asks the one endpoint for the five series', async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify(healthy()), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      const snapshot = await readStalenessSnapshot(NOW, { baseUrl: 'http://prometheus:9090/', timeoutMs: 50, staleWindowHours: 26 });

      expect(snapshot.readings.map((reading) => reading.state)).toEqual(['current', 'current']);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(
        `http://prometheus:9090/api/v1/query?query=${encodeURIComponent(STALENESS_QUERY)}`,
      );
    });
  });

  it('takes the window from BACKUP_STALE_HOURS, the knob the scripts used', () => {
    expect(stalenessOptionsFromEnv({})).toMatchObject({ staleWindowHours: 26, baseUrl: 'http://prometheus:9090' });
    expect(stalenessOptionsFromEnv({ BACKUP_STALE_HOURS: '8', PROMETHEUS_URL: 'http://p:1' })).toMatchObject({
      staleWindowHours: 8,
      baseUrl: 'http://p:1',
    });
    expect(stalenessOptionsFromEnv({ BACKUP_STALE_HOURS: 'nonsense' }).staleWindowHours).toBe(26);
  });
});
