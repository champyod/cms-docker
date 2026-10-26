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
import { SYSTEM_IDENTITIES, withActor } from '@/lib/db-actor';

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

/**
 * WHY this is a function and not top-level `await`: the panel's package is CommonJS (no
 * `"type": "module"`, and the image's build is CJS), so `tsx` refuses to transform a top-level await —
 * the service died at import with `Top-level await is currently not supported with the "cjs" output
 * format` and restart-looped, which is how it was found in production. An async `main()` is the same
 * program under either module format.
 */
async function main(): Promise<void> {
  log(`starting: every ${intervalMs() / 1000}s`);
  // WHY the whole loop runs inside withActor(): every table this reads is row-level secured on
  // `cms.actor`, and this process has no request and no cookie to resolve one from — without a named
  // scope each tick fails with "no database actor" and the front keeps a config nobody refreshed.
  // `system:cli` because the reconciler is repository automation acting for the deployment (it reads the
  // wiring registry and writes the front's files, never a row the panel owns), and naming it keeps the
  // audit trail honest instead of borrowing an admin's identity.
  await withActor({ kind: 'system', name: SYSTEM_IDENTITIES.CLI }, () =>
    runReconciler({ once, log, intervalMs: intervalMs(), signal: controller.signal }),
  );
  log('stopped');
}

main().catch((error: unknown) => {
  // A refused startup (no socket, no registry, unreadable certificate) is a real failure and must
  // exit non-zero: a container that stays "up" while reconciling nothing is worse than one that stops.
  log(`fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
