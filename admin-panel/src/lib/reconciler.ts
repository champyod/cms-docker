/**
 * The reconciler: re-renders the routes from the database on a timer, and reloads only when the
 * rendered set differs from what the front is serving.
 *
 * WHY it exists: the panel's Save & apply covers the person clicking it, and a migration, a seed, another
 * agent or a raw SQL fix covers nobody. This loop is what makes those rows live.
 *
 * WHY it never builds config: it calls the same `applyExposureArtifacts` the save path calls, so there is
 * one place that decides file names, bytes and the staged `nginx -t`.
 */
import { applyExposureArtifacts, type ApplyOutcome, type FrontRunner } from './exposure-apply';
import type { ExposureRow } from './service-wiring';
import { renderRegistryArtifacts, type WiringPayload } from './service-wiring-artifacts';
import type { CertificateSpec } from './service-wiring-render';

/** A row the renderer refused, kept beside the reason so the loop can log one line and move on. */
export interface SkippedExposure {
  readonly exposure: ExposureRow;
  readonly reason: string;
}

export interface ReconcileResult {
  readonly reloaded: boolean;
  readonly changed: readonly string[];
  readonly skipped: readonly SkippedExposure[];
}

export interface ReconcileDeps {
  readonly liveDir: string;
  readonly stagingDir: string;
  readonly readPayload: () => Promise<WiringPayload>;
  readonly readFrontVhosts: () => Promise<readonly string[]>;
  readonly front: FrontRunner;
  readonly certificate?: CertificateSpec;
  readonly log: (line: string) => void;
}

export interface ReconcilerOptions {
  readonly once: () => Promise<ReconcileResult>;
  readonly log: (line: string) => void;
  /** Defaults to a real timer; injected so a test can drive ticks without waiting. */
  readonly waitFor?: (milliseconds: number) => Promise<void>;
  readonly intervalMs?: number;
  readonly signal?: AbortSignal;
}

const DEFAULT_INTERVAL_MS = 60_000;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** How one exposure is named in a log line: the same label the panel shows for the row. */
function describe(exposure: ExposureRow): string {
  const hostname = (exposure.hostname ?? '').trim();
  return `${hostname === '' ? '(path only)' : hostname}${exposure.path}`;
}

function withoutExposure(payload: WiringPayload, index: number): WiringPayload {
  return { ...payload, exposures: payload.exposures.filter((_, position) => position !== index) };
}

/**
 * The payload minus the rows that cannot render, found by removal.
 *
 * WHY removal and not a per-row render: a path-only exposure needs its contest's vhost, so rendering it
 * alone would refuse a row that is fine in company. Dropping one row at a time and re-rendering the set
 * blames a row only when the set renders without it.
 */
async function isolateUnrenderable(
  payload: WiringPayload,
  frontVhosts: readonly string[],
): Promise<{ kept: WiringPayload; skipped: SkippedExposure[] }> {
  const skipped: SkippedExposure[] = [];
  let kept = payload;
  for (let attempt = 0; attempt <= payload.exposures.length; attempt += 1) {
    try {
      renderRegistryArtifacts(kept, frontVhosts);
      return { kept, skipped };
    } catch (error) {
      const reason = messageOf(error);
      let culprit: ExposureRow | null = null;
      for (let index = 0; index < kept.exposures.length; index += 1) {
        try {
          renderRegistryArtifacts(withoutExposure(kept, index), frontVhosts);
          culprit = kept.exposures[index];
          break;
        } catch {
          continue;
        }
      }
      // A refusal no single row explains is a broken registry, not a bad exposure: let the caller report it.
      if (culprit === null) throw error;
      skipped.push({ exposure: culprit, reason });
      kept = { ...kept, exposures: kept.exposures.filter((row) => row !== culprit) };
    }
  }
  return { kept, skipped };
}

/**
 * One pass: read the registry, drop what cannot render, apply what can.
 *
 * WHY a read failure throws instead of writing an empty set: an unreachable database says nothing about
 * the routes, and an empty include set would take every exposed route off the front.
 */
export async function reconcileOnce(deps: ReconcileDeps): Promise<ReconcileResult> {
  const [payload, frontVhosts] = await Promise.all([deps.readPayload(), deps.readFrontVhosts()]);
  const { kept, skipped } = await isolateUnrenderable(payload, frontVhosts);
  for (const row of skipped) {
    deps.log(`skipping exposure ${describe(row.exposure)}: ${row.reason}`);
  }
  const outcome: ApplyOutcome = await applyExposureArtifacts(kept, {
    liveDir: deps.liveDir,
    stagingDir: deps.stagingDir,
    frontVhosts,
    front: deps.front,
    certificate: deps.certificate,
  });
  if (outcome.kind === 'refused') {
    deps.log(`apply refused at ${outcome.stage}: ${outcome.error}; keeping the front's current config`);
    return { reloaded: false, changed: [], skipped };
  }
  return { reloaded: outcome.changed.length > 0, changed: [...outcome.changed], skipped };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Ticks until the signal aborts. WHY a caught tick: a loop that stops on one failure stops reconciling. */
export async function runReconciler(options: ReconcilerOptions): Promise<void> {
  const waitFor = options.waitFor ?? sleep;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const signal = options.signal;
  const isStopped = (): boolean => signal?.aborted === true;
  while (!isStopped()) {
    try {
      const result = await options.once();
      options.log(
        `tick: ${result.changed.length} changed, ${result.reloaded ? 'reloaded' : 'no reload'}` +
        `${result.skipped.length === 0 ? '' : `, ${result.skipped.length} skipped`}`,
      );
    } catch (error) {
      options.log(`tick failed: ${messageOf(error)}; keeping the front's current config`);
    }
    if (isStopped()) return;
    await waitFor(intervalMs);
  }
}
