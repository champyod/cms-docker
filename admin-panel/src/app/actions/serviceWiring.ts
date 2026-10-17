'use server';

import { exec } from 'child_process';
import util from 'util';

import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';
import { resolveHostComposeLocation } from '@/lib/compose-location';
import { readDeploymentModeSetting } from '@/lib/deployment-mode-file';
import { runConfigSync } from '@/lib/deploy-config';
import { readFrontVhosts } from '@/lib/front-vhosts';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { buildComposeFileFlags, buildRestartCommand } from '@/lib/restart-planner';
import {
  FRONT_RELOAD_COMMAND,
  registryApplyPlan,
  TAILSCALE_COMPOSE_FILE,
  type RegistryApplyPlan,
  type RegistryChangeClass,
} from '@/lib/restart-service-scope';
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
 * Re-runs the config sync from the panel.
 *
 * WHY the command is fixed and never operator text: the sync is the one writer of the
 * generated artifacts, and a request that chose the command would turn the panel into an
 * arbitrary shell. WHY an audit row: a sync rewrites the front's routes, so who ran it and
 * whether it succeeded has to outlive the toast.
 */
export async function resyncRegistryAction(): Promise<WriteResult> {
  try {
    await ensurePermission('container:control');
  } catch (error) {
    return { success: false, error: denialMessage(error) };
  }
  try {
    await runConfigSync();
    await recordAudit({ verb: 'service-wiring:resync', entity: 'service_registry', result: 'success' });
    return { success: true };
  } catch (error) {
    const message = denialMessage(error);
    await recordAudit({ verb: 'service-wiring:resync', entity: 'service_registry', result: 'failure', reason: message });
    return { success: false, error: message };
  }
}

/**
 * Applies one registry change by class: the command comes from the reviewed plan, so the panel
 * never assembles shell from a request, and a recreate goes through the same planner the restart
 * page uses, so the two cannot disagree about a compose invocation.
 */
export async function applyRegistryChangeAction(
  changeClass: RegistryChangeClass,
  services: string[],
): Promise<WriteResult> {
  try {
    await ensurePermission('container:control');
  } catch (error) {
    return { success: false, error: denialMessage(error) };
  }
  const plan = registryApplyPlan(changeClass, services);
  try {
    await runRegistryApply(plan);
    await recordAudit({ verb: 'service-wiring:apply', entity: 'service_registry', afterValues: { changeClass, services }, result: 'success' });
    return { success: true };
  } catch (error) {
    const message = denialMessage(error);
    await recordAudit({ verb: 'service-wiring:apply', entity: 'service_registry', afterValues: { changeClass, services }, result: 'failure', reason: message });
    return { success: false, error: message };
  }
}

/** Runs a plan: a front reload after a sync, or a targeted recreate of exactly the named services. */
async function runRegistryApply(plan: RegistryApplyPlan): Promise<void> {
  const rootDir = getRepoRoot();
  if (plan.kind === 'front-reload') {
    await runConfigSync();
    await execPromise(FRONT_RELOAD_COMMAND, { cwd: rootDir });
    return;
  }
  if (plan.services.length === 0) throw new Error('a recreate needs at least one service');
  if (plan.compose === 'tailscale') {
    await execPromise(`docker compose -f ${TAILSCALE_COMPOSE_FILE} up -d ${plan.services.join(' ')}`, { cwd: rootDir });
    return;
  }
  await runConfigSync();
  const files = await buildComposeFileFlags();
  const location = await resolveHostComposeLocation();
  if (!location.ok) throw new Error(location.error);
  const mode = (await readDeploymentModeSetting()).mode;
  const restart = await buildRestartCommand('custom', [...plan.services], files, mode, location.location);
  if (!restart.skip) await execPromise(restart.command, { cwd: rootDir, timeout: 120000 });
}
