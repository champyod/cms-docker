'use server';

import { exec } from 'child_process';
import util from 'util';

import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';
import { runConfigSync } from '@/lib/deploy-config';
import { readFrontVhosts } from '@/lib/front-vhosts';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { FRONT_RELOAD_COMMAND } from '@/lib/restart-service-scope';
import { renderRegistryArtifacts, type RegistryArtifact } from '@/lib/service-wiring-cli';
import {
  removeExposure,
  removeService,
  removeWiring,
  saveExposure,
  saveService,
  saveWiring,
} from '@/lib/panel-actions';
import { requirePanelActorId } from '@/lib/panel-actor';
import { readRegistry } from '@/lib/service-wiring-store';
import type {
  ExposureInput,
  ExposureRecord,
  ServiceInput,
  ServiceRecord,
  WiringInput,
  WiringRecord,
  WriteResult,
} from '@/lib/service-wiring-contract';

const execPromise = util.promisify(exec);

/**
 * The server boundary for the registry screen.
 *
 * WHY every action calls ensurePermission itself rather than through a shared helper:
 * the repository's permission-coverage suite reads each exported action and requires a
 * demanded key to be visible in its own body, so an indirect check would leave the
 * boundary invisible to the guard that exists to prove it is there.
 *
 * WHY container:control for reads as well as writes: a service row carries internal
 * hostnames and ports, so knowing the deployment's shape is an infrastructure
 * privilege rather than a general one.
 */
const REGISTRY_PATH = '/[locale]/infrastructure/services';

export interface RegistryView {
  services: ServiceRecord[];
  wirings: WiringRecord[];
  exposures: ExposureRecord[];
}

export type RegistryResult =
  | { success: true; registry: RegistryView }
  | { success: false; error: string };

function denialMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'not permitted';
}

/** Revalidates only a write that succeeded, so a rejected edit leaves the screen as it was. */
async function afterWrite(write: () => Promise<WriteResult>): Promise<WriteResult> {
  const result = await write();
  if (result.success) revalidatePath(REGISTRY_PATH, 'page');
  return result;
}

/**
 * Saves one registry row. The write itself is `saveService`, so the panel editor and
 * `./cms panel registry bind` cannot disagree about what a row means.
 */
export async function saveServiceAction(input: ServiceInput): Promise<WriteResult> {
  try {
    await ensurePermission('container:control');
    const actorId = await requirePanelActorId();
    return await afterWrite(() => saveService(actorId, input));
  } catch (error) {
    return { success: false, error: denialMessage(error) };
  }
}

export async function removeServiceAction(id: number): Promise<WriteResult> {
  try {
    await ensurePermission('container:control');
  } catch (error) {
    return { success: false, error: denialMessage(error) };
  }
  return afterWrite(() => removeService(id));
}

export async function saveWiringAction(input: WiringInput): Promise<WriteResult> {
  try {
    await ensurePermission('container:control');
  } catch (error) {
    return { success: false, error: denialMessage(error) };
  }
  return afterWrite(() => saveWiring(input));
}

export async function removeWiringAction(id: number): Promise<WriteResult> {
  try {
    await ensurePermission('container:control');
  } catch (error) {
    return { success: false, error: denialMessage(error) };
  }
  return afterWrite(() => removeWiring(id));
}

export async function saveExposureAction(input: ExposureInput): Promise<WriteResult> {
  try {
    await ensurePermission('container:control');
  } catch (error) {
    return { success: false, error: denialMessage(error) };
  }
  return afterWrite(() => saveExposure(input));
}

export async function removeExposureAction(id: number): Promise<WriteResult> {
  try {
    await ensurePermission('container:control');
  } catch (error) {
    return { success: false, error: denialMessage(error) };
  }
  return afterWrite(() => removeExposure(id));
}

export async function getRegistryAction(): Promise<RegistryResult> {
  try {
    await ensurePermission('container:control');
  } catch (error) {
    return { success: false, error: denialMessage(error) };
  }
  try {
    return { success: true, registry: await readRegistry() };
  } catch (error) {
    return { success: false, error: denialMessage(error) };
  }
}

export type PreviewResult =
  | { success: true; artifacts: RegistryArtifact[] }
  | { success: false; error: string };

/**
 * The artifacts the next config sync would write, rendered in-process.
 *
 * WHY the renderer is imported rather than the CLI shelled out: the panel must preview
 * exactly what the sync writes, and importing `renderRegistryArtifacts` keeps both on one
 * implementation, so a preview can never disagree with the sync about the registry's shape.
 */
export async function previewRegistryAction(): Promise<PreviewResult> {
  try {
    await ensurePermission('container:control');
  } catch (error) {
    return { success: false, error: denialMessage(error) };
  }
  try {
    return { success: true, artifacts: renderRegistryArtifacts(await readRegistry(), await readFrontVhosts()) };
  } catch (error) {
    return { success: false, error: denialMessage(error) };
  }
}

/**
 * Applies a registry change: re-render the artifacts, then reload the front that serves them.
 *
 * WHY both halves: the sync writes the generated routes, and a front that keeps its rendered config
 * keeps serving the old ones — the screen's own copy already says "re-sync, then reload nginx in the
 * front", so a sync that stopped at the files would promise a change it never applied.
 *
 * WHY the commands are fixed and never operator text: the sync and the reload are the one writer of
 * the generated artifacts, and a request that chose the command would turn the panel into an
 * arbitrary shell. WHY an audit row: a sync rewrites the front's routes, so who ran it and whether
 * it succeeded has to outlive the toast.
 *
 * WHY there is no recreate class here: a registry edit that needed containers recreated used to
 * have its own action, which nothing ever called. Recreating a service is the restart the registry
 * exists to replace, so the hot half is applied and the restart lever is not offered.
 */
export async function resyncRegistryAction(): Promise<WriteResult> {
  try {
    await ensurePermission('container:control');
  } catch (error) {
    return { success: false, error: denialMessage(error) };
  }
  try {
    await runConfigSync();
    await execPromise(FRONT_RELOAD_COMMAND, { cwd: getRepoRoot() });
    await recordAudit({ verb: 'service-wiring:resync', entity: 'service_registry', result: 'success' });
    return { success: true };
  } catch (error) {
    const message = denialMessage(error);
    await recordAudit({ verb: 'service-wiring:resync', entity: 'service_registry', result: 'failure', reason: message });
    return { success: false, error: message };
  }
}
