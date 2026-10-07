import { scopedServiceList, STACK_SERVICES } from './compose-command';

/** Profiles of the unified project, in the order the Makefile lists them. */
export type ComposeProfile = 'core' | 'admin' | 'contest' | 'monitor';

const PROFILE_ORDER: readonly ComposeProfile[] = ['core', 'admin', 'contest', 'monitor'];

/**
 * Every service of the unified project and the profile gating it, as docker-compose.yml declares
 * them (checked with `docker compose --profile <p> config --services`). Requests reach the planner
 * in two shapes — the UI asks for a compose service (`monitor`), while config/restart_policies.json
 * names containers (`cms-database`) — and a compose `up` accepts only the service name, so this
 * table is what turns a request into an argument and into the profile that exposes it.
 */
const SERVICE_PROFILES: Readonly<Record<string, ComposeProfile>> = {
  database: 'core',
  'log-service': 'core',
  'resource-service': 'core',
  'scoring-service': 'core',
  'checker-service': 'core',
  'admin-panel-next': 'admin',
  'admin-web-server': 'admin',
  'ranking-web-server': 'admin',
  'evaluation-service': 'contest',
  'proxy-service': 'contest',
  'contest-web-server': 'contest',
  'nginx-proxy': 'contest',
  monitor: 'monitor',
};

/** Container names that are not their service name behind a `cms-` prefix. */
const CONTAINER_ALIASES: Readonly<Record<string, string>> = {
  'cms-nginx-contest': 'nginx-proxy',
};

/** The compose service a request names, or the request itself when the project does not declare it. */
export function asService(requested: string): string {
  if (SERVICE_PROFILES[requested]) return requested;
  const alias = CONTAINER_ALIASES[requested];
  if (alias) return alias;
  const stripped = requested.startsWith('cms-') ? requested.slice('cms-'.length) : requested;
  return SERVICE_PROFILES[stripped] ? stripped : requested;
}

/**
 * The profiles an `up` has to enable for these services, core included next to admin/contest:
 * compose rejects a project whose profile-gated service depends on a disabled one ("service
 * ranking-web-server depends on undefined service database"), which is exactly why the Makefile's
 * ADMIN_UP_PROFILES/CONTEST_UP_PROFILES carry core. A name the project does not declare contributes
 * no profile — compose rejects it on its own, and guessing a profile would restart more than asked.
 */
export function profilesForServices(services: readonly string[]): readonly ComposeProfile[] {
  const wanted = new Set<ComposeProfile>();
  for (const service of services) {
    const profile = SERVICE_PROFILES[service];
    if (profile) wanted.add(profile);
  }
  if (wanted.has('admin') || wanted.has('contest')) wanted.add('core');
  return PROFILE_ORDER.filter(profile => wanted.has(profile));
}

/** The services each profile exposes in the unified project, `monitor` included. */
const PROFILE_SERVICES: Readonly<Record<ComposeProfile, readonly string[]>> = {
  core: STACK_SERVICES.core,
  admin: STACK_SERVICES.admin,
  contest: STACK_SERVICES.contest,
  monitor: ['monitor'],
};

/**
 * The services a restart of these profiles is scoped to.
 *
 * Why every target names its services: an empty list means the whole enabled project, and the
 * panel's own project declares a service that backs a protected container (see
 * PROTECTED_COMPOSE_SERVICES). A stack restart carries no container id, so the name guard in
 * lib/protected-containers.ts cannot see it — the scope is what bounds the reach.
 */
export function servicesForProfiles(profiles: readonly ComposeProfile[]): readonly string[] {
  return scopedServiceList(profiles.flatMap(profile => PROFILE_SERVICES[profile]));
}
