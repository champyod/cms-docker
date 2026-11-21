import { recordAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { assertSafeHostname, assertSafePath, assertSafeTailnetNode, RenderError } from '@/lib/service-wiring-render';
import { normalisePath, WiringError } from '@/lib/service-wiring';
import {
  PROXY_SERVICE_ROLE,
  PULL_POLICIES,
  SERVICE_ROLES,
  type ExposureInput,
  type ServiceInput,
  type ServiceRole,
  type WiringInput,
  type WriteResult,
} from '@/lib/service-wiring-contract';

/**
 * The write side of the service registry, and the one write that decides which contest a shard
 * serves: the `services` row's role, shard and contest_id.
 *
 * WHY validation runs before every write: the renderer refuses a hostname it cannot put in an
 * nginx directive, so a row that reached the table without passing the same check would turn a bad
 * edit into a failed deployment instead of a rejected form. The validators are the renderer's own,
 * so there is one definition of 'safe'.
 *
 * WHY an edit targets the row id while a create refuses a collision: a service name, a wiring
 * triple and an exposure location each name an existing row, so an upsert on that key silently
 * rewrites whichever row holds it — another contest's, for an exposure. An edit therefore updates
 * by id, and a create that would collide is a domain error the operator resolves rather than a
 * second row that replaces the first.
 *
 * WHY the panel's server action and the `./cms` CLI both call this module: the binding is one
 * fact, so the panel editor and the script-side verb have to reach it through one implementation
 * or the two drift. The action adds the permission check and the screen refresh; the CLI adds the
 * `root` actor. Nothing here imports a request-time Next API, so the CLI runs it in-process with
 * no panel server up.
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

/**
 * One service by name, created or corrected — the name is the stable key.
 *
 * WHY this write carries an actor and audits while the row-level aliases beside it do not: it is
 * the binding `./cms panel registry bind` drives, and a script-side write has to leave the same
 * trail the panel's does. The aliases serve the panel's registry editor alone, which logs them as
 * it always has.
 */
export async function saveService(actorId: number, input: ServiceInput): Promise<WriteResult> {
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
    await recordBinding(actorId, data);
    return { success: true };
  } catch (error) {
    return { success: false, error: messageOf(error) };
  }
}

/** The audit row the panel and the CLI both leave for a binding write, filed under one verb. */
async function recordBinding(
  actorId: number,
  row: Pick<ServiceInput, 'name' | 'role' | 'shard' | 'contest_id'>,
): Promise<void> {
  await recordAudit({
    actorId,
    verb: 'service-wiring:save',
    entity: 'service_registry',
    entityId: row.name,
    afterValues: { name: row.name, role: row.role, shard: row.shard, contest_id: row.contest_id },
    result: 'success',
  });
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

/** Which contest one registry row's shard serves, as `./cms panel registry bind` states it. */
export interface ServiceBinding {
  readonly service: string;
  readonly contestId: number | null;
}

/**
 * Points a registry row at the contest its shard serves, keeping every other field.
 *
 * WHY the read-then-write goes through `saveService`: the contest a shard serves is one column of
 * one row, so a second, narrower `services.update` would be a second implementation of the same
 * write — the panel editor's edit and this verb would then be able to disagree about the row. The
 * whole row is therefore re-validated and written by the one writer, and `saveService` audits it.
 *
 * WHY a refusal rather than a skip for a name or a contest that does not exist: a binding that
 * silently matched nothing would read back as a success while the shard still served the old
 * contest. The three refusals are the ones a script-side caller cannot see on a screen.
 */
export async function bindServiceContest(actorId: number, binding: ServiceBinding): Promise<void> {
  const name = binding.service.trim();
  if (name === '') throw new WiringError('a binding needs the service it names');
  const row = await prisma.services.findUnique({
    where: { name },
    select: {
      id: true,
      name: true,
      role: true,
      shard: true,
      host: true,
      http_port: true,
      rpc_port: true,
      db_profile: true,
      enabled: true,
      image: true,
      pull_policy: true,
    },
  });
  if (row === null) throw new WiringError(`no service named ${name}`);
  if (binding.contestId !== null) {
    const contest = await prisma.contests.findUnique({
      where: { id: binding.contestId },
      select: { id: true },
    });
    if (contest === null) throw new WiringError(`no contest with id ${binding.contestId}`);
  }
  const result = await saveService(actorId, {
    id: row.id,
    name: row.name,
    role: row.role as ServiceRole,
    shard: row.shard,
    host: row.host,
    http_port: row.http_port,
    rpc_port: row.rpc_port,
    db_profile: row.db_profile,
    contest_id: binding.contestId,
    enabled: row.enabled,
    image: row.image ?? '',
    pull_policy: row.pull_policy,
  });
  if (!result.success) throw new WiringError(result.error ?? 'the binding was refused');
}
