/**
 * Which file owns an exposure's route: `config.toml` for a curated route, the database for the rest.
 *
 * WHY it reuses `frontVhostRefusal` rather than repeating the rule: that function already decides
 * whether the front's own vhost answers the path, and a second predicate would let the screen and the
 * renderer disagree about who owns a route.
 */
import {
  contestVhosts,
  indexServices,
  normalisePath,
  primaryVhost,
  type ExposureRow,
  type ServiceRow,
} from './service-wiring';
import {
  effectiveHostname,
  frontVhostOf,
  frontVhostRefusal,
  NO_OPERATOR_KEY,
  parseFrontVhostList,
  type FrontVhost,
} from './service-wiring-front-vhosts';

export const CONFIG_TOML_FILE = 'config.toml';
export const FRONT_TEMPLATE_FILE = 'config/grader.nginx.conf.template';
export const FRONT_CONFIG_FILE = 'config/grader.nginx.conf';

/** The database owns the route, so the panel's own controls may move it. */
export interface DatabaseOwnership {
  readonly kind: 'database';
}

/**
 * `config.toml` — or one of the files it is rendered into — owns the route.
 *
 * `key` is the operator's `*_ROUTE_PATH` name when one owns the path, and null where the route is a
 * literal of the front's template or a vhost the rendered config declares on its own.
 */
export interface CuratedOwnership {
  readonly kind: 'curated';
  readonly file: string;
  readonly key: string | null;
  readonly reason: string;
}

export type ExposureOwnership = DatabaseOwnership | CuratedOwnership;

/** The file and key behind a refusal: the key when the route table names one, else the declaring file. */
function curatedSource(front: FrontVhost, path: string): { file: string; key: string | null } {
  if (front.label === null) return { file: FRONT_CONFIG_FILE, key: null };
  if (front.paths.length === 0) return { file: CONFIG_TOML_FILE, key: null };
  const key = front.pathKeys.get(path);
  if (key === undefined || key === NO_OPERATOR_KEY) return { file: FRONT_TEMPLATE_FILE, key: null };
  return { file: CONFIG_TOML_FILE, key };
}

/**
 * The owner of each exposure's route, in the order the rows arrived.
 *
 * WHY null for an exposition the registry cannot resolve: a row naming a service the registry lost has
 * no owner to report, and the problems list already explains it — claiming a source here would name a
 * file that never renders the row.
 */
export function exposureOwnerships(
  exposures: ExposureRow[],
  services: ServiceRow[],
  frontVhosts: readonly string[] = [],
): (ExposureOwnership | null)[] {
  const byId = indexServices(services);
  const vhosts = contestVhosts(exposures, services);
  const primary = primaryVhost(exposures);
  const front = parseFrontVhostList(frontVhosts);
  return exposures.map((exposure) => {
    const service = byId.get(exposure.service_id);
    if (service === undefined) return null;
    const hostname = effectiveHostname(exposure, service, vhosts, primary);
    if (hostname === '') return null;
    const path = normalisePath(exposure.path);
    const own = frontVhostOf(hostname, front);
    const reason = frontVhostRefusal(path, own);
    if (reason === null || own === null) return { kind: 'database' };
    return { kind: 'curated', ...curatedSource(own, path), reason };
  });
}
