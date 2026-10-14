import { prisma } from '@/lib/prisma';
import { assertSafeHostname, assertSafePath, assertSafeTailnetNode, RenderError } from './service-wiring-render';
import { WiringError } from './service-wiring';
import {
  SERVICE_ROLES,
  type ExposureInput,
  type ExposureRecord,
  type ServiceInput,
  type ServiceRecord,
  type WiringInput,
  type WiringRecord,
  type WriteResult,
} from './service-wiring-contract';

/**
 * The write side of the service registry.
 *
 * WHY validation runs before every write: the renderer refuses a hostname it cannot
 * put in an nginx directive, so a row that reached the table without passing the same
 * check would turn a bad edit into a failed deployment instead of a rejected form.
 * The validators are the renderer's own, so there is one definition of 'safe'.
 */

const HOST_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9_.-]{0,62}[a-zA-Z0-9])?$/;
const MIN_PORT = 1;
const MAX_PORT = 65535;

function assertPort(port: number | null, field: string): void {
  if (port === null) return;
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new WiringError(`${field} must be an integer between ${MIN_PORT} and ${MAX_PORT}`);
  }
}

/** A service is only usable if it has somewhere to be reached, and a name to be wired by. */
export function validateService(input: ServiceInput): void {
  if (input.name.trim() === '') throw new WiringError('a service needs a name');
  if (!HOST_PATTERN.test(input.host)) {
    throw new WiringError(`unsafe host: ${JSON.stringify(input.host)}`);
  }
  if (!(SERVICE_ROLES as readonly string[]).includes(input.role)) {
    throw new WiringError(`unknown role: ${input.role}`);
  }
  if (input.http_port === null && input.rpc_port === null) {
    throw new WiringError('a service needs an http_port, an rpc_port, or both');
  }
  assertPort(input.http_port, 'http_port');
  assertPort(input.rpc_port, 'rpc_port');
  if (input.shard < 0) throw new WiringError('shard cannot be negative');
  if (input.db_profile.trim() === '') throw new WiringError('db_profile cannot be empty');
}

/**
 * An exposure becomes an nginx server block and, when named, a tailnet file on disk, so
 * its hostname, path and node are all checked here as well as at render time.
 */
export function validateExposure(input: ExposureInput): void {
  assertSafeHostname(input.hostname);
  assertSafePath(input.path);
  if (input.tailnet === null) return;
  if (input.tailnet.trim() === '') {
    throw new WiringError('tailnet must be a node name or null, never empty');
  }
  assertSafeTailnetNode(input.tailnet);
}

function messageOf(error: unknown): string {
  if (error instanceof WiringError || error instanceof RenderError) return error.message;
  return error instanceof Error ? error.message : 'unexpected failure';
}

/** One service by name, created or corrected — the name is the stable key. */
export async function saveService(input: ServiceInput): Promise<WriteResult> {
  try {
    validateService(input);
    const data = { ...input, name: input.name.trim(), host: input.host.trim() };
    await prisma.services.upsert({ where: { name: data.name }, create: data, update: data });
    return { success: true };
  } catch (error) {
    return { success: false, error: messageOf(error) };
  }
}

export async function removeService(id: number): Promise<WriteResult> {
  try {
    await prisma.services.delete({ where: { id } });
    return { success: true };
  } catch (error) {
    return { success: false, error: messageOf(error) };
  }
}

/** A wiring is a triple, so re-adding an existing edge is an update rather than a duplicate. */
export async function saveWiring(input: WiringInput): Promise<WriteResult> {
  try {
    if (input.from_service_id === input.to_service_id) {
      throw new WiringError('a service cannot be wired to itself');
    }
    if (input.relation.trim() === '') throw new WiringError('a wiring needs a relation');
    const key = {
      from_service_id: input.from_service_id,
      to_service_id: input.to_service_id,
      relation: input.relation.trim(),
    };
    await prisma.wirings.upsert({
      where: { from_service_id_to_service_id_relation: key },
      create: { ...key, enabled: input.enabled },
      update: { enabled: input.enabled },
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: messageOf(error) };
  }
}

export async function removeWiring(id: number): Promise<WriteResult> {
  try {
    await prisma.wirings.delete({ where: { id } });
    return { success: true };
  } catch (error) {
    return { success: false, error: messageOf(error) };
  }
}

export async function saveExposure(input: ExposureInput): Promise<WriteResult> {
  try {
    validateExposure(input);
    const key = { hostname: input.hostname.trim().toLowerCase(), path: input.path };
    const data = { ...input, ...key };
    await prisma.contest_exposures.upsert({ where: { hostname_path: key }, create: data, update: data });
    return { success: true };
  } catch (error) {
    return { success: false, error: messageOf(error) };
  }
}

export async function removeExposure(id: number): Promise<WriteResult> {
  try {
    await prisma.contest_exposures.delete({ where: { id } });
    return { success: true };
  } catch (error) {
    return { success: false, error: messageOf(error) };
  }
}

/** Everything the panel renders, in one round trip per table. */
export async function readRegistry(): Promise<{
  services: ServiceRecord[];
  wirings: WiringRecord[];
  exposures: ExposureRecord[];
}> {
  const [services, wirings, exposures] = await Promise.all([
    prisma.services.findMany({ orderBy: [{ role: 'asc' }, { shard: 'asc' }] }),
    prisma.wirings.findMany({ orderBy: { id: 'asc' } }),
    prisma.contest_exposures.findMany({ orderBy: { contest_id: 'asc' } }),
  ]);
  return { services, wirings, exposures };
}
