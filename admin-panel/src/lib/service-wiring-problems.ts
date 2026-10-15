/**
 * The faults a registry would hit on the next sync, collected rather than thrown so the
 * screen can list every one before an operator runs a sync.
 *
 * WHY its own module: it mirrors the resolver's rules rather than being part of them —
 * the sync renders routes, the screen lists problems — and holding both in one file grew
 * it past the size one module is allowed.
 */
import {
  contestVhosts,
  effectiveHostname,
  indexServices,
  normalisePath,
  primaryVhost,
  type ExposureRow,
  type ServiceRow,
  type WiringRow,
} from './service-wiring';
import { PROXY_SERVICE_ROLE } from './service-wiring-contract';

export type WiringProblemArea = 'service' | 'wiring' | 'exposure';

export interface WiringProblem {
  area: WiringProblemArea;
  message: string;
}

/** A wiring needs both endpoints, an exposure a service that can answer on its vhost. */
export function collectWiringProblems(
  services: ServiceRow[],
  wirings: WiringRow[],
  exposures: ExposureRow[],
): WiringProblem[] {
  const problems: WiringProblem[] = [];
  const endpointIds = new Set(services.map((service) => service.id));
  for (const wiring of wirings) {
    const missing = !endpointIds.has(wiring.from_service_id) || !endpointIds.has(wiring.to_service_id);
    if (missing) {
      problems.push({
        area: 'wiring',
        message: `wiring ${wiring.from_service_id} -> ${wiring.to_service_id} names a service that does not exist`,
      });
    }
  }
  problems.push(...misboundServiceProblems(services));
  problems.push(...exposedServiceProblems(services, exposures));
  problems.push(...unhostedPathProblems(services, exposures));
  problems.push(...duplicateLocationProblems(services, exposures));
  return problems;
}

/**
 * A service the registry authors but the running stack cannot honour.
 *
 * WHY the proxy alone: it relays exactly one contest's submissions to the rankings, so a row of
 * it that names no contest leaves a running container with nothing to relay. The write side
 * refuses that, and this lists it for a row that predates the rule.
 */
function misboundServiceProblems(services: ServiceRow[]): WiringProblem[] {
  const problems: WiringProblem[] = [];
  for (const service of services) {
    if (service.role === PROXY_SERVICE_ROLE && service.contest_id === null) {
      problems.push({
        area: 'service',
        message: `service ${service.name} is a ${PROXY_SERVICE_ROLE} that names no contest — it relays exactly one, so it needs a row per contest`,
      });
    }
  }
  return problems;
}

/** An exposure needs a service the registry carries, enabled, with an HTTP port to dial. */
function exposedServiceProblems(services: ServiceRow[], exposures: ExposureRow[]): WiringProblem[] {
  const byId = indexServices(services);
  const problems: WiringProblem[] = [];
  const reported = new Set<number>();
  for (const exposure of exposures) {
    if (reported.has(exposure.service_id)) continue;
    reported.add(exposure.service_id);
    const service = byId.get(exposure.service_id);
    if (service === undefined) {
      problems.push({
        area: 'exposure',
        message: `exposure names service ${exposure.service_id}, which the registry does not carry`,
      });
      continue;
    }
    if (!service.enabled) {
      problems.push({ area: 'exposure', message: `service ${service.name} is exposed but not enabled` });
      continue;
    }
    if (service.http_port === null) {
      problems.push({ area: 'exposure', message: `service ${service.name} is exposed but has no http_port to dial` });
    }
  }
  return problems;
}

/** A path-only exposure whose service's contest claims no hostname has no vhost to answer in. */
function unhostedPathProblems(services: ServiceRow[], exposures: ExposureRow[]): WiringProblem[] {
  const byId = indexServices(services);
  const vhosts = contestVhosts(exposures, services);
  const primary = primaryVhost(exposures);
  const problems: WiringProblem[] = [];
  for (const exposure of exposures) {
    const service = byId.get(exposure.service_id);
    if (service === undefined) continue;
    if ((exposure.hostname ?? '').trim() !== '') continue;
    if (effectiveHostname(exposure, service, vhosts, primary) !== '') continue;
    problems.push({
      area: 'exposure',
      message: `service ${service.name} exposes ${normalisePath(exposure.path)} with no hostname and no vhost of its own`,
    });
  }
  return problems;
}

/** Two exposures that resolve to one rendered location, whichever vhost each one named. */
function duplicateLocationProblems(services: ServiceRow[], exposures: ExposureRow[]): WiringProblem[] {
  const byId = indexServices(services);
  const vhosts = contestVhosts(exposures, services);
  const primary = primaryVhost(exposures);
  const countByLocation = new Map<string, number>();
  for (const exposure of exposures) {
    const service = byId.get(exposure.service_id);
    if (service === undefined) continue;
    const location = `${effectiveHostname(exposure, service, vhosts, primary).toLowerCase()}${normalisePath(exposure.path)}`;
    countByLocation.set(location, (countByLocation.get(location) ?? 0) + 1);
  }
  const problems: WiringProblem[] = [];
  for (const [location, count] of countByLocation) {
    if (count > 1) problems.push({ area: 'exposure', message: `${count} exposures claim ${location}` });
  }
  return problems;
}
