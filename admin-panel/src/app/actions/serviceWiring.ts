'use server';

import { revalidatePath } from 'next/cache';
import { ensurePermission } from '@/lib/permissions';
import {
  readRegistry,
  removeExposure,
  removeService,
  removeWiring,
  saveExposure,
  saveService,
  saveWiring,
  type ExposureInput,
  type ServiceInput,
  type WiringInput,
  type WriteResult,
} from '@/lib/service-wiring-store';

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
const REGISTRY_PATH = '/[locale]/settings';

export interface RegistryView {
  services: ServiceInput[];
  wirings: WiringInput[];
  exposures: ExposureInput[];
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

export async function saveServiceAction(input: ServiceInput): Promise<WriteResult> {
  try {
    await ensurePermission('container:control');
  } catch (error) {
    return { success: false, error: denialMessage(error) };
  }
  return afterWrite(() => saveService(input));
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
