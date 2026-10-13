/**
 * The one place that turns the service registry, its wirings and each contest's
 * exposure into the concrete routes the renderers consume.
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
  port: number;
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

export interface ExposureRow {
  contest_id: number;
  hostname: string;
  path: string;
  tls: boolean;
  tailnet: string | null;
}

/** One server block: where a contest answers, and which endpoint serves it. */
export interface Route {
  contest_id: number;
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

/**
 * Builds one route per exposure, resolving its upstream to the contest's own
 * ContestWebServer when it has one and to the shared one otherwise.
 */
export function exposureRoutes(exposures: ExposureRow[], services: ServiceRow[]): Route[] {
  const candidates = services.filter((s) => s.enabled && s.role === CONTEST_WEB_SERVER_ROLE);
  const routes: Route[] = [];
  for (const exposure of exposures) {
    const upstream = pickUpstream(exposure.contest_id, candidates);
    routes.push({
      contest_id: exposure.contest_id,
      hostname: exposure.hostname.trim(),
      path: normalisePath(exposure.path),
      upstream: `${upstream.host}:${upstream.port}`,
      tls: exposure.tls,
      tailnet: exposure.tailnet,
    });
  }
  return routes;
}

const CONTEST_WEB_SERVER_ROLE = 'ContestWebServer';

/** A contest's own server wins over the shared one; ties break on the lowest shard. */
function pickUpstream(contestId: number, candidates: ServiceRow[]): ServiceRow {
  let best: ServiceRow | null = null;
  for (const service of candidates) {
    if (service.contest_id !== null && service.contest_id !== contestId) continue;
    if (best === null) { best = service; continue; }
    const closer = service.contest_id === contestId && best.contest_id !== contestId;
    if (closer || (service.contest_id === best.contest_id && service.shard < best.shard)) {
      best = service;
    }
  }
  if (best === null) {
    throw new WiringError(`contest ${contestId} has no ContestWebServer to answer on`);
  }
  return best;
}
