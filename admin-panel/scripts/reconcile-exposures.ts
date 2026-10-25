#!/usr/bin/env bun
/**
 * The exposure reconciler: a loop inside the deployment that re-renders the routes from the database
 * and reloads the front only when the rendered set differs.
 *
 * WHY a script and not a host cron: hosts stay operator-manual by decision, and the deployment already
 * carries the repository mount and the docker socket the render and the reload need.
 *
 *   EXPOSURE_RECONCILE_INTERVAL_SECS=60 tsx scripts/reconcile-exposures.ts
 *
 * Exits only on SIGTERM/SIGINT; a failed tick is logged and the loop continues, because a loop that
 * stops on one bad read stops reconciling without saying so.
 */
import path from 'path';

import {
  createFrontRunner,
  discoverFrontContainer,
  liveArtifactsDir,
  readServedCertificate,
  STAGING_DIR_NAME,
} from '@/lib/front-nginx';
import { readFrontVhosts } from '@/lib/front-vhosts';
import { reconcileOnce, runReconciler, type ReconcileResult } from '@/lib/reconciler';
import { readRegistry } from '@/lib/service-wiring-store';

const DEFAULT_INTERVAL_SECS = 60;

function intervalMs(): number {
  const raw = process.env.EXPOSURE_RECONCILE_INTERVAL_SECS ?? '';
  const seconds = Number.parseInt(raw, 10);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_INTERVAL_SECS) * 1000;
}

function log(line: string): void {
  process.stdout.write(`[exposure-reconciler ${new Date().toISOString()}] ${line}\n`);
}

async function once(): Promise<ReconcileResult> {
  const container = await discoverFrontContainer();
  if (container === null) {
    log('no front container is running; nothing to reconcile');
    return { reloaded: false, changed: [], skipped: [] };
  }
  const liveDir = liveArtifactsDir();
  const result = await reconcileOnce({
    liveDir,
    stagingDir: path.join(liveDir, STAGING_DIR_NAME),
    readPayload: readRegistry,
    readFrontVhosts,
    front: createFrontRunner(container),
    certificate: await readServedCertificate(),
    log,
  });
  if (result.reloaded) log(`front reloaded for ${result.changed.join(', ')}`);
  return result;
}

const controller = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => controller.abort());
}

log(`starting: every ${intervalMs() / 1000}s`);
await runReconciler({ once, log, intervalMs: intervalMs(), signal: controller.signal });
log('stopped');
