/**
 * Applies one saved exposure to the running front: render the whole set to a staging directory,
 * prove it with the front's own `nginx -t`, only then swap and reload.
 *
 * WHY the order: a bad row must never be able to take the front down, so the file the front reads is
 * the last thing touched and the previous one comes back if the reload refuses.
 */
import fs from 'fs/promises';
import path from 'path';

import { applyRegistryArtifacts, type ArtifactWrite } from './service-wiring-apply';
import type { WiringPayload } from './service-wiring-artifacts';
import type { CertificateSpec } from './service-wiring-render';

/** Which guard refused the save. */
export type ApplyStage = 'validation' | 'nginx-test' | 'reload';

export type ApplyOutcome =
  | { readonly kind: 'applied'; readonly changed: readonly string[] }
  | { readonly kind: 'refused'; readonly stage: ApplyStage; readonly error: string };

/** The front's two verbs, so the orchestration is testable without a container. */
export interface FrontRunner {
  readonly testStagedConfig: (stagingDir: string) => Promise<string>;
  readonly reloadFront: () => Promise<string>;
}

export interface ExposureApplyRuntime {
  readonly liveDir: string;
  /** Inside `liveDir`, so the front's own mount makes the staged files readable to it. */
  readonly stagingDir: string;
  readonly frontVhosts: readonly string[];
  readonly front: FrontRunner;
  readonly certificate?: CertificateSpec;
}

/** Bytes the live file held before the swap, or null when it did not exist. */
interface Backup {
  readonly path: string;
  readonly content: string | null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readOrNull(file: string): Promise<string | null> {
  return fs.readFile(file, 'utf8').catch(() => null);
}

function refused(stage: ApplyStage, error: unknown): ApplyOutcome {
  return { kind: 'refused', stage, error: messageOf(error) };
}

/** Moves one staged change into the live directory, keeping what it replaced for a rollback. */
async function swapOne(liveDir: string, stagingDir: string, write: ArtifactWrite): Promise<Backup> {
  const live = path.join(liveDir, write.path);
  const content = await readOrNull(live);
  if (write.status === 'removed') {
    await fs.rm(live, { force: true });
    return { path: write.path, content };
  }
  await fs.mkdir(path.dirname(live), { recursive: true });
  await fs.rename(path.join(stagingDir, write.path), live);
  return { path: write.path, content };
}

/** Puts every swapped file back, so a refused reload leaves the front reading what it read before. */
async function restoreAll(liveDir: string, backups: readonly Backup[]): Promise<void> {
  for (const backup of backups) {
    const live = path.join(liveDir, backup.path);
    if (backup.content === null) {
      await fs.rm(live, { force: true });
      continue;
    }
    await fs.writeFile(live, backup.content);
  }
}

/**
 * Renders, proves, swaps, reloads.
 *
 * WHY a save that changed no byte is still a success with no reload: the row was saved, and
 * reloading a config the front already serves only risks an outage for nothing.
 */
export async function applyExposureArtifacts(
  payload: WiringPayload,
  runtime: ExposureApplyRuntime,
): Promise<ApplyOutcome> {
  await fs.rm(runtime.stagingDir, { recursive: true, force: true });
  let report: ArtifactWrite[];
  try {
    // WHY the renderer writes to staging and not to the live directory: every guard below runs
    // before the front can read a single new byte.
    report = await applyRegistryArtifacts(payload, {
      outDir: runtime.stagingDir,
      compareDir: runtime.liveDir,
      frontVhosts: runtime.frontVhosts,
      certificate: runtime.certificate,
    });
  } catch (error) {
    await fs.rm(runtime.stagingDir, { recursive: true, force: true });
    return refused('validation', error);
  }

  const changed = report.filter((write) => write.status !== 'unchanged');
  if (changed.length === 0) {
    await fs.rm(runtime.stagingDir, { recursive: true, force: true });
    return { kind: 'applied', changed: [] };
  }

  try {
    await runtime.front.testStagedConfig(runtime.stagingDir);
  } catch (error) {
    await fs.rm(runtime.stagingDir, { recursive: true, force: true });
    return refused('nginx-test', error);
  }

  const backups: Backup[] = [];
  for (const write of changed) backups.push(await swapOne(runtime.liveDir, runtime.stagingDir, write));

  try {
    await runtime.front.reloadFront();
  } catch (error) {
    await restoreAll(runtime.liveDir, backups);
    await fs.rm(runtime.stagingDir, { recursive: true, force: true });
    return refused('reload', error);
  }

  await fs.rm(runtime.stagingDir, { recursive: true, force: true });
  return { kind: 'applied', changed: changed.map((write) => write.path) };
}
