import { prisma } from '@/lib/prisma';
import { assertSafeHostname, assertSafePath, assertSafeTailnetNode, RenderError } from './service-wiring-render';
import { normalisePath, WiringError } from './service-wiring';
import {
  PROXY_SERVICE_ROLE,
  PULL_POLICIES,
  SERVICE_ROLES,
  type ExposureInput,
  type ExposureRecord,
  type ServiceInput,
  type ServiceRecord,
  type WiringInput,
  type WiringRecord,
  type WriteResult,
} from './service-wiring-contract';
import { PANEL_READ_TIMEOUT_MS, withTimeout } from './with-timeout';

/**
 * The write side of the service registry.
 *
 * WHY validation runs before every write: the renderer refuses a hostname it cannot
 * put in an nginx directive, so a row that reached the table without passing the same
 * check would turn a bad edit into a failed deployment instead of a rejected form.
 * The validators are the renderer's own, so there is one definition of 'safe'.
 *
 * WHY an edit targets the row id while a create refuses a collision: a service name, a
 * wiring triple and an exposure location each name an existing row, so an upsert on that
 * key silently rewrites whichever row holds it — another contest's, for an exposure. An
 * edit therefore updates by id, and a create that would collide is a domain error the
 * operator resolves rather than a second row that replaces the first.
 */

const HOST_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9_.-]{0,62}[a-zA-Z0-9])?$/;
// A container image reference reaches the generated compose verbatim, so it is held to what
// an image name can be: registry[:port]/path[:tag]@digest — never whitespace or a newline.
const IMAGE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/:@]*$/;
const MIN_PORT = 1;
const MAX_PORT = 65535;
const PRISMA_UNIQUE_CONSTRAINT = 'P2002';

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
  if (input.image.trim() !== '' && !IMAGE_PATTERN.test(input.image.trim())) {
    throw new WiringError(`unsafe image reference: ${JSON.stringify(input.image)}`);
  }
  if (!(PULL_POLICIES as readonly string[]).includes(input.pull_policy)) {
    throw new WiringError(`unknown pull policy: ${input.pull_policy}`);
  }
  // WHY a ProxyService must name one: it relays exactly one contest's submissions to the
  // rankings, and a row that names none leaves a running container with nothing to relay —
  // refused here rather than discovered as a crash loop on the next deploy.
  if (input.role === PROXY_SERVICE_ROLE && input.contest_id === null) {
    throw new WiringError(
      `a ${PROXY_SERVICE_ROLE} row must name the contest whose board it feeds`);
  }
}

/**
 * An exposure becomes an nginx server block and, when named, a tailnet file on disk, so
 * its hostname, path and node are all checked here as well as at render time.
 *
 * WHY the path is normalised before the check: `/beta/` and `/beta` render to one
 * location, so only the normalised form can be the stored key — otherwise the same
 * location exists twice and the unique index cannot see it.
 */
export function validateExposure(input: ExposureInput): void {
  if (input.hostname.trim() !== '') assertSafeHostname(input.hostname);
  assertSafePath(normalisePath(input.path));
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

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { code?: unknown }).code === PRISMA_UNIQUE_CONSTRAINT;
}

/** Runs a write and turns the database's unique-key rejection into a domain error. */
async function persistUnique(subject: string, write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (error) {
    if (isUniqueViolation(error)) throw new WiringError(`${subject} already exists`);
    throw error;
  }
}

/** One service by name, created or corrected — the name is the stable key. */
export async function saveService(input: ServiceInput): Promise<WriteResult> {
  try {
    validateService(input);
    const image = input.image.trim();
    const data = { ...input, name: input.name.trim(), host: input.host.trim(), image: image === '' ? null : image };
    const id = input.id;
    await persistUnique(`a service named ${data.name}`, () =>
      id === undefined
        ? prisma.services.create({ data })
        : prisma.services.update({ where: { id }, data })
    );
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

/** A wiring is a triple, so an edit corrects that triple's row rather than adding a second edge. */
export async function saveWiring(input: WiringInput): Promise<WriteResult> {
  try {
    if (input.from_service_id === input.to_service_id) {
      throw new WiringError('a service cannot be wired to itself');
    }
    if (input.relation.trim() === '') throw new WiringError('a wiring needs a relation');
    const data = {
      from_service_id: input.from_service_id,
      to_service_id: input.to_service_id,
      relation: input.relation.trim(),
      enabled: input.enabled,
    };
    const id = input.id;
    await persistUnique('a wiring with this relation', () =>
      id === undefined
        ? prisma.wirings.create({ data })
        : prisma.wirings.update({ where: { id }, data })
    );
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
    const hostname = input.hostname.trim().toLowerCase();
    const key = {
      service_id: input.service_id,
      hostname: hostname === '' ? null : hostname,
      path: normalisePath(input.path),
    };
    const data = { ...input, ...key };
    const id = input.id;
    await persistUnique('an exposure on this location', () =>
      id === undefined
        ? prisma.contest_exposures.create({ data })
        : prisma.contest_exposures.update({ where: { id }, data })
    );
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
  const [services, wirings, exposures] = await withTimeout(
    Promise.all([
      prisma.services.findMany({ orderBy: [{ role: 'asc' }, { shard: 'asc' }] }),
      prisma.wirings.findMany({ orderBy: { id: 'asc' } }),
      prisma.contest_exposures.findMany({ orderBy: { id: 'asc' } }),
    ]),
    PANEL_READ_TIMEOUT_MS,
    'The registry read did not finish in time.',
  );
  // WHY the panel sees '' and not null: a path-only row has no hostname and a row with no
  // image has no tag, so the form edits each absence as an empty field and the two
  // representations meet here.
  const panelExposures = exposures.map((exposure) => ({ ...exposure, hostname: exposure.hostname ?? '' }));
  const panelServices = services.map((service) => ({ ...service, image: service.image ?? '' }));
  return { services: panelServices, wirings, exposures: panelExposures };
}
