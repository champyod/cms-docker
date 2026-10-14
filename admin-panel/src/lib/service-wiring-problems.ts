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
  normalisePath,
  CONTEST_WEB_SERVER_ROLE,
  type ExposureRow,
  type ServiceRow,
  type WiringRow,
} from './service-wiring';

export type WiringProblemArea = 'contest' | 'wiring' | 'exposure';

export interface WiringProblem {
  area: WiringProblemArea;
  message: string;
}

/** A wiring needs both endpoints, an exposed contest a server, a path exposure a vhost. */
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
  problems.push(...unservedContestProblems(services, exposures));
  problems.push(...unhostedPathProblems(exposures));
  problems.push(...duplicateLocationProblems(exposures));
  return problems;
}

/** A path-only exposure whose contest names no hostname of its own has no vhost to answer in. */
function unhostedPathProblems(exposures: ExposureRow[]): WiringProblem[] {
  const vhosts = contestVhosts(exposures);
  const problems: WiringProblem[] = [];
  for (const exposure of exposures) {
    if ((exposure.hostname ?? '').trim() !== '' || vhosts.has(exposure.contest_id)) continue;
    problems.push({
      area: 'exposure',
      message: `contest ${exposure.contest_id} exposes ${normalisePath(exposure.path)} with no hostname and no vhost of its own`,
    });
  }
  return problems;
}

/** A contest is served when any enabled ContestWebServer is bound to it or shared. */
function unservedContestProblems(services: ServiceRow[], exposures: ExposureRow[]): WiringProblem[] {
  const servers = services.filter((service) => service.enabled && service.role === CONTEST_WEB_SERVER_ROLE);
  const shared = servers.some((service) => service.contest_id === null);
  const bound = new Set(servers.map((service) => service.contest_id));
  const problems: WiringProblem[] = [];
  const seen = new Set<number>();
  for (const { contest_id } of exposures) {
    if (seen.has(contest_id)) continue;
    seen.add(contest_id);
    if (shared || bound.has(contest_id)) continue;
    problems.push({ area: 'contest', message: `contest ${contest_id} is exposed but no ContestWebServer serves it` });
  }
  return problems;
}

/** Two exposures that resolve to one rendered location, whichever vhost each one named. */
function duplicateLocationProblems(exposures: ExposureRow[]): WiringProblem[] {
  const vhosts = contestVhosts(exposures);
  const countByLocation = new Map<string, number>();
  for (const exposure of exposures) {
    const location = `${effectiveHostname(exposure, vhosts).toLowerCase()}${normalisePath(exposure.path)}`;
    countByLocation.set(location, (countByLocation.get(location) ?? 0) + 1);
  }
  const problems: WiringProblem[] = [];
  for (const [location, count] of countByLocation) {
    if (count > 1) problems.push({ area: 'exposure', message: `${count} exposures claim ${location}` });
  }
  return problems;
}
