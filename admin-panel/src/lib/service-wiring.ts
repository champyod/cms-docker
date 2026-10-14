/**
 * The one place that turns the service registry, its wirings and each exposure into the
 * concrete routes the renderers consume.
 *
 * WHY a resolver rather than four ad-hoc queries: nginx, the tailnet serve entries
 * and the panel all read the same rows, so one validated shape stops the three from
 * disagreeing about what is wired to what. Every function here is pure, so the
 * wiring rules are testable without a database or a container.
 */

export interface ServiceRow {
  id: number;
  name: string;
  role: string;
  shard: number;
  host: string;
  http_port: number | null;
  rpc_port: number | null;
  db_profile: string;
  contest_id: number | null;
  enabled: boolean;
}

export interface WiringRow {
  from_service_id: number;
  to_service_id: number;
  relation: string;
  enabled: boolean;
}

/**
 * Where a service answers. WHY the exposure names a service and not a contest: the row is
 * what runs, so one statement decides both what is served and where it is reachable, and a
 * service no contest owns — the admin panel, the ranking board — can be exposed too.
 *
 * Rows reach here ordered by id, which is what makes the first hostname a contest claims the
 * one a path-only exposure of that contest joins.
 */
export interface ExposureRow {
  service_id: number;
  hostname: string | null;
  path: string;
  tls: boolean;
  tailnet: string | null;
}

/** One server block: where a service answers, and the endpoint that serves it. */
export interface Route {
  hostname: string;
  path: string;
  upstream: string;
  tls: boolean;
  tailnet: string | null;
}

/** A resolved edge, because a bare id pair says nothing about what it links. */
export interface ResolvedWiring {
  from: ServiceRow;
  to: ServiceRow;
  relation: string;
}

/**
 * A wiring named a service the registry does not carry, or a route has no upstream.
 * Thrown rather than skipped: a generic registry makes an unregistered service
 * invisible, and silently rendering nothing is the failure this type exists to stop.
 */
export class WiringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WiringError';
  }
}

const ROOT_PATH = '/';

/** O(1) lookup by id for the join every other function performs. */
export function indexServices(services: ServiceRow[]): Map<number, ServiceRow> {
  const byId = new Map<number, ServiceRow>();
  for (const service of services) {
    byId.set(service.id, service);
  }
  return byId;
}

/**
 * Normalises an operator-entered path to one leading slash and no trailing one,
 * so `/beta`, `beta` and `beta/` cannot produce three nginx location blocks.
 */
export function normalisePath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === ROOT_PATH) return ROOT_PATH;
  const leading = trimmed.startsWith(ROOT_PATH) ? trimmed : ROOT_PATH + trimmed;
  return leading.endsWith(ROOT_PATH) ? leading.slice(0, -1) : leading;
}

/**
 * Joins wirings onto their endpoints. Disabled rows are dropped, but an id that
 * names no service is fatal even when disabled, because it means the registry lost
 * a row something still references.
 */
export function resolveWirings(services: ServiceRow[], wirings: WiringRow[]): ResolvedWiring[] {
  const byId = indexServices(services);
  const resolved: ResolvedWiring[] = [];
  for (const wiring of wirings) {
    const from = byId.get(wiring.from_service_id);
    const to = byId.get(wiring.to_service_id);
    if (from === undefined) {
      throw new WiringError(`wiring references unknown service id ${wiring.from_service_id}`);
    }
    if (to === undefined) {
      throw new WiringError(`wiring references unknown service id ${wiring.to_service_id}`);
    }
    if (!wiring.enabled) continue;
    resolved.push({ from, to, relation: wiring.relation });
  }
  return resolved;
}

/**
 * The services a contest can use: those bound to it, plus the shared ones
 * (contest_id null) that serve every contest. Enabling a contest never requires
 * duplicating a service row it shares with the others.
 */
export function servicesForContest(contestId: number, services: ServiceRow[]): ServiceRow[] {
  return services.filter((service) => {
    if (!service.enabled) return false;
    return service.contest_id === null || service.contest_id === contestId;
  });
}

/** The service an exposure routes to. An id the registry lost is fatal, never skipped. */
export function exposedService(exposure: ExposureRow, byId: Map<number, ServiceRow>): ServiceRow {
  const service = byId.get(exposure.service_id);
  if (service === undefined) {
    throw new WiringError(`exposure names unknown service id ${exposure.service_id}`);
  }
  return service;
}

/**
 * The vhost each contest claims through the hostname of an exposure routing to one of its
 * services, so a path-only exposure answers on the site that contest already serves.
 *
 * WHY keyed on the contest and not the service: two servers of one contest are one site, so a
 * path exposure needs no hostname of its own. A service no contest owns claims nothing here,
 * and takes the deployment's own hostname instead (see primaryVhost).
 */
export function contestVhosts(exposures: ExposureRow[], services: ServiceRow[]): Map<number, string> {
  const byId = indexServices(services);
  const vhosts = new Map<number, string>();
  for (const exposure of exposures) {
    const hostname = (exposure.hostname ?? '').trim();
    if (hostname === '') continue;
    const service = byId.get(exposure.service_id);
    if (service === undefined || service.contest_id === null) continue;
    if (!vhosts.has(service.contest_id) || normalisePath(exposure.path) === ROOT_PATH) {
      vhosts.set(service.contest_id, hostname);
    }
  }
  return vhosts;
}

/**
 * The deployment's own hostname: the root exposure named first, else the first one named at
 * all. A path-only exposure of a service no contest owns answers there, because no contest
 * site exists for it to join.
 */
export function primaryVhost(exposures: ExposureRow[]): string {
  const named = exposures.filter((exposure) => (exposure.hostname ?? '').trim() !== '');
  const root = named.find((exposure) => normalisePath(exposure.path) === ROOT_PATH);
  return ((root ?? named[0])?.hostname ?? '').trim();
}

/** The vhost an exposure answers under; empty means there is none and the caller must refuse. */
export function effectiveHostname(
  exposure: ExposureRow,
  service: ServiceRow,
  vhosts: Map<number, string>,
  primary: string,
): string {
  const own = (exposure.hostname ?? '').trim();
  if (own !== '') return own;
  if (service.contest_id === null) return primary;
  return vhosts.get(service.contest_id) ?? '';
}

/** One route per exposure: its service's endpoint, under the vhost the exposure answers on. */
export function exposureRoutes(exposures: ExposureRow[], services: ServiceRow[]): Route[] {
  const byId = indexServices(services);
  const vhosts = contestVhosts(exposures, services);
  const primary = primaryVhost(exposures);
  const routes: Route[] = [];
  for (const exposure of exposures) {
    const service = exposedService(exposure, byId);
    if (!service.enabled) {
      throw new WiringError(`service ${service.name} is exposed but not enabled`);
    }
    const path = normalisePath(exposure.path);
    const hostname = effectiveHostname(exposure, service, vhosts, primary);
    if (hostname === '') {
      throw new WiringError(`service ${service.name} exposes ${path} with no hostname and no vhost of its own to answer under`);
    }
    routes.push({
      hostname,
      path,
      upstream: toHttpEndpoint(service),
      tls: exposure.tls,
      tailnet: exposure.tailnet,
    });
  }
  return routes;
}

/**
 * The endpoint a front door proxies to. WHY http_port and not rpc_port: the two are
 * genuinely different ports on the same process, and a front door that dialled the
 * RPC port would hang rather than fail, so a missing HTTP port is refused here.
 */
function toHttpEndpoint(service: ServiceRow): string {
  if (service.http_port === null) {
    throw new WiringError(`service ${service.name} has no http_port to proxy to`);
  }
  return `${service.host}:${service.http_port}`;
}
