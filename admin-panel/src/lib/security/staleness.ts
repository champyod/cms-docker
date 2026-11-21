import type { StalenessChannel, StalenessReading, StalenessSnapshot } from '@/lib/security/signal';

/**
 * How old the newest backup and offsite copy are — read from the series the backup scripts already
 * publish, never recomputed here.
 *
 * WHY Prometheus and not the textfile: the scripts write `backups/metrics/cms_backup.prom`, and
 * node-exporter's textfile collector republishes it as `cms_backup_*` / `cms_offsite_*`
 * (docker-compose.monitoring.yml). Re-reading the file would need the panel and this service to
 * mount the archive tree, and — worse — it would let a second implementation decide what "stale"
 * means. The scripts already decide: `cms_backup_stale` and `cms_offsite_stale` are their verdict,
 * computed with `BACKUP_STALE_HOURS` (default 26, scripts/__lib/common.sh). This module reads that
 * verdict and never re-derives it. There is one definition of "stale" in this repo and it lives in
 * the script that writes the series.
 *
 * WHY the scrape target and not the file's mtime alone: the publisher also stamps
 * `cms_backup_metrics_written_timestamp_seconds` ("if it stops advancing nothing is publishing
 * backup ages any more"), so a `stale=0` left behind by a dead writer can be told apart from a
 * healthy one. The bound used for that is `BACKUP_STALE_HOURS` again — the same window, not a
 * second threshold — because every backup run and every offsite sync rewrites the file: a file
 * older than the window means no run happened inside it.
 *
 * WHY `unknown` is a first-class state: a monitoring stack that is merely missing must never read
 * as "the backup is fine". Every failure path below returns `unknown` with a reason, and with no
 * series at all both channels are `unknown`.
 */

export const STALENESS_QUERY =
  '{__name__=~"cms_backup_stale|cms_offsite_stale|cms_backup_last_success_age_seconds|' +
  'cms_offsite_last_ship_age_seconds|cms_backup_metrics_written_timestamp_seconds"}';

/** The series carrying each channel's verdict and age. One table, so a channel is a row. */
const SERIES: Record<StalenessChannel, { readonly stale: string; readonly age: string }> = {
  backup: { stale: 'cms_backup_stale', age: 'cms_backup_last_success_age_seconds' },
  offsite: { stale: 'cms_offsite_stale', age: 'cms_offsite_last_ship_age_seconds' },
};

const WRITTEN_SERIES = 'cms_backup_metrics_written_timestamp_seconds';

/** Same default the scripts use (`BACKUP_METRICS_STALE_DEFAULT_HOURS`). */
export const DEFAULT_STALE_WINDOW_HOURS = 26;
export const DEFAULT_PROMETHEUS_URL = 'http://prometheus:9090';
/** Short enough that a dead monitoring stack cannot hold a page render. */
export const DEFAULT_TIMEOUT_MS = 1500;

export interface StalenessOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  /** `BACKUP_STALE_HOURS`, the window the scripts used when they wrote the verdict. */
  readonly staleWindowHours: number;
}

export function stalenessOptionsFromEnv(env: Record<string, string | undefined> = process.env): StalenessOptions {
  const baseUrl = env.PROMETHEUS_URL?.trim();
  const window = Number.parseInt(env.BACKUP_STALE_HOURS ?? '', 10);
  const timeout = Number.parseInt(env.SECURITY_SIGNAL_PROMETHEUS_TIMEOUT_MS ?? '', 10);
  return {
    baseUrl: baseUrl === undefined || baseUrl === '' ? DEFAULT_PROMETHEUS_URL : baseUrl,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
    staleWindowHours:
      Number.isFinite(window) && window > 0 ? window : DEFAULT_STALE_WINDOW_HOURS,
  };
}

/** Both channels `unknown`, for every path where nothing could be read. */
export function unknownStaleness(detail: string, source: string | null = null): StalenessSnapshot {
  return {
    readings: (Object.keys(SERIES) as StalenessChannel[]).map((channel) => ({
      channel,
      state: 'unknown' as const,
      ageSeconds: null,
      observedAtSeconds: null,
      detail,
    })),
    source,
  };
}

interface PromSample {
  readonly metric: Record<string, string>;
  readonly value: readonly [number, string];
}

function samplesOf(payload: unknown): PromSample[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const body = payload as { status?: unknown; data?: { result?: unknown } };
  if (body.status !== 'success') return null;
  const result = body.data?.result;
  if (!Array.isArray(result)) return null;
  const samples: PromSample[] = [];
  for (const entry of result) {
    if (typeof entry !== 'object' || entry === null) continue;
    const sample = entry as { metric?: unknown; value?: unknown };
    if (typeof sample.metric !== 'object' || sample.metric === null) continue;
    if (!Array.isArray(sample.value) || sample.value.length !== 2) continue;
    const [timestamp, raw] = sample.value as [unknown, unknown];
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) continue;
    samples.push({
      metric: sample.metric as Record<string, string>,
      value: [Number(timestamp), String(raw)],
    });
  }
  return samples;
}

/** The newest numeric sample of one series, or null when the series is not there. */
function latest(samples: readonly PromSample[], name: string): number | null {
  let found: number | null = null;
  let newest = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    if (sample.metric.__name__ !== name) continue;
    const value = Number(sample.value[1]);
    if (!Number.isFinite(value)) continue;
    if (sample.value[0] >= newest) {
      newest = sample.value[0];
      found = value;
    }
  }
  return found;
}

/**
 * Turns one Prometheus response into the two readings.
 *
 * WHY the publisher's write stamp is judged before its verdict: `cms_backup_stale` is computed when
 * the file is written, so it describes that instant forever. A writer that stopped an hour after
 * writing `0` would otherwise certify a healthy backup indefinitely. A `stale=1` is still believed,
 * because a stale backup cannot have become less stale with time.
 */
export function parseStalenessPayload(
  payload: unknown,
  now: Date,
  options: Pick<StalenessOptions, 'staleWindowHours'>,
  source: string | null,
): StalenessSnapshot {
  const samples = samplesOf(payload);
  if (samples === null) {
    return unknownStaleness('Prometheus answered with something that is not a query result', source);
  }
  const written = latest(samples, WRITTEN_SERIES);
  const windowSeconds = options.staleWindowHours * 3600;
  const writerIdleSeconds = written === null ? null : Math.max(0, now.getTime() / 1000 - written);
  const writerDead = writerIdleSeconds !== null && writerIdleSeconds > windowSeconds;

  const readings = (Object.keys(SERIES) as StalenessChannel[]).map((channel): StalenessReading => {
    const series = SERIES[channel];
    const stale = latest(samples, series.stale);
    const age = latest(samples, series.age);
    const observedAtSeconds = written;
    if (stale === null) {
      return {
        channel,
        state: 'unknown',
        ageSeconds: age,
        observedAtSeconds,
        detail:
          `no ${series.stale} series: the ${channel === 'backup' ? 'backup' : 'offsite'} publisher has not ` +
          'written its state file, or the scrape target does not see it',
      };
    }
    if (stale !== 0) {
      return {
        channel,
        state: 'stale',
        ageSeconds: age,
        observedAtSeconds,
        detail:
          age === null
            ? 'the producer reports no proven run'
            : `newest proven copy is ${String(Math.round(age / 3600))}h old (window ${String(options.staleWindowHours)}h)`,
      };
    }
    if (writerDead) {
      return {
        channel,
        state: 'unknown',
        ageSeconds: age,
        observedAtSeconds,
        detail:
          `the publisher last wrote ${String(Math.round((writerIdleSeconds ?? 0) / 3600))}h ago ` +
          `(window ${String(options.staleWindowHours)}h): its "not stale" verdict describes that moment, not now`,
      };
    }
    return { channel, state: 'current', ageSeconds: age, observedAtSeconds, detail: null };
  });

  return { readings, source };
}

/**
 * Reads both readings from Prometheus, or reports both `unknown`.
 *
 * WHY one request: the five series live on one endpoint and one scrape, so a second round trip
 * would only add a way for the two channels to describe different instants.
 */
export async function readStalenessSnapshot(
  now: Date = new Date(),
  options: StalenessOptions = stalenessOptionsFromEnv(),
): Promise<StalenessSnapshot> {
  const url = `${options.baseUrl.replace(/\/$/, '')}/api/v1/query?query=${encodeURIComponent(STALENESS_QUERY)}`;
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs),
      cache: 'no-store',
    });
    if (!response.ok) {
      return unknownStaleness(`Prometheus answered ${String(response.status)} at ${options.baseUrl}`);
    }
    return parseStalenessPayload(await response.json(), now, options, options.baseUrl);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return unknownStaleness(`Prometheus is not reachable at ${options.baseUrl} (${reason})`);
  }
}

/**
 * A render-time cache in front of the reading above.
 *
 * WHY: the snapshot costs one HTTP call with a 1.5 s timeout, and the patching page plus the overview
 * render it on every request. A dead monitoring stack would therefore hold every page for the timeout —
 * latency paid by the operator for a fact that changes at most once per backup run (hours).
 *
 * WHY a cache and not a second reading: it stores the output of the same function for the same options,
 * so there is still one query, one parser and one definition of "stale". It is not a fallback — when the
 * call fails the failure is cached too, for the same short window, so a page cannot hammer a dead target.
 *
 * WHY process-local: the panel is allowed to run several instances, and a divergence between them for
 * seconds has no meaning when the underlying series move on the scale of hours. A shared cache would be
 * a new service dependency for a value that is already stale by design.
 */
export const DEFAULT_READING_CACHE_MS = 15_000;

interface CachedReading {
  readonly expiresAt: number;
  readonly value: Promise<StalenessSnapshot>;
}

let cache: CachedReading | null = null;

/** Test seam: lets a test assert two renders in the same window share one call, then start over. */
export function resetStalenessCache(): void {
  cache = null;
}

export function stalenessCacheMs(
  env: Record<string, string | undefined> = { SECURITY_STALENESS_CACHE_MS: process.env.SECURITY_STALENESS_CACHE_MS },
): number {
  const raw = env.SECURITY_STALENESS_CACHE_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_READING_CACHE_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_READING_CACHE_MS;
}

/** The reading a page render should use. Same function, same verdict, at most one call per window. */
export function readStalenessSnapshotCached(
  options: StalenessOptions = stalenessOptionsFromEnv(),
  ttlMs: number = stalenessCacheMs(),
): Promise<StalenessSnapshot> {
  const now = Date.now();
  if (cache !== null && cache.expiresAt > now) return cache.value;
  const value = readStalenessSnapshot(new Date(), options);
  cache = { expiresAt: now + ttlMs, value };
  return value;
}

