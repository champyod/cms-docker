import { scopedServiceList, STACK_SERVICES } from './compose-command';

/** Profiles of the unified project, in the order the Makefile lists them. */
export type ComposeProfile = 'core' | 'admin' | 'contest' | 'proxy' | 'monitor';

const PROFILE_ORDER: readonly ComposeProfile[] = ['core', 'admin', 'contest', 'proxy', 'monitor'];

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
  'nginx-proxy': 'proxy',
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
  // The optional contest front depends on the contest services, so enabling its profile
  // alone would leave compose rejecting it as a project whose dependencies are disabled.
  if (wanted.has('proxy')) {
    wanted.add('core');
    wanted.add('contest');
  }
  return PROFILE_ORDER.filter(profile => wanted.has(profile));
}

/** The services each profile exposes in the unified project, `monitor` included. */
const PROFILE_SERVICES: Readonly<Record<ComposeProfile, readonly string[]>> = {
  core: STACK_SERVICES.core,
  admin: STACK_SERVICES.admin,
  contest: STACK_SERVICES.contest,
  proxy: ['nginx-proxy'],
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

/** The hot-apply class of a registry change, from the design's hot-apply map. */
export type RegistryChangeClass = 'front-reload' | 'service-recreate' | 'tailnet-node';

/** The script the front reloads its routed config with, and the project a tailnet node container lives in. */
export const FRONT_RELOAD_COMMAND = 'bash scripts/__domain_proxy_reload.sh';
export const TAILSCALE_COMPOSE_FILE = 'docker-compose.tailscale.generated.yml';

/** A service name safe to reach a shell: the alphabet docker compose and this project use. */
const SAFE_SERVICE_NAME = /^[a-zA-Z0-9_-]+$/;

/**
 * The plan one registry change class applies.
 *
 * WHY a closed class set and a resolved plan rather than a command from the caller: a class names
 * how a change is picked up, and the command it maps to is reviewable here. Anything the request
 * contributes is filtered to a safe service name before it can reach a shell. front-reload: the
 * next sync rewrites the routes and the front reloads them, so nothing restarts and nothing mounted
 * is disturbed. recreate: a targeted compose recreate of exactly the named services, on the main
 * stack or on the generated tailnet project that owns a node's own container.
 */
export type RegistryApplyPlan =
  | { readonly kind: 'front-reload' }
  | { readonly kind: 'recreate'; readonly compose: 'stack' | 'tailscale'; readonly services: readonly string[] };

export function registryApplyPlan(changeClass: RegistryChangeClass, services: readonly string[]): RegistryApplyPlan {
  if (changeClass === 'front-reload') return { kind: 'front-reload' };
  const safe = services.filter((service) => SAFE_SERVICE_NAME.test(service));
  return {
    kind: 'recreate',
    compose: changeClass === 'tailnet-node' ? 'tailscale' : 'stack',
    services: scopedServiceList(safe),
  };
}
