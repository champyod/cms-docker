import fs from 'fs/promises';
import path from 'path';
import { getRepoRoot } from './repo-root';
import { composeLocationFlags, type HostComposeLocation } from './compose-location';
import { buildWorkerControlCommand, scopedServiceList, STACK_SERVICES } from './compose-command';
import type { DeploymentMode } from './deployment-mode';
import { collectContestServices, getRestartPolicies } from './restart-policies';

export type { RestartPolicies } from './restart-policies';
export { analyzeContainerDependencies, getRestartPolicies } from './restart-policies';

export type RestartCommandPlan =
  | { skip: true; message: string }
  | { skip: false; command: string };

/** The unified project the make targets and `./cms` deploy, plus the override they pick up with it. */
export const COMPOSE_BASE_FILE = 'docker-compose.yml';
export const COMPOSE_OVERRIDE_FILE = 'docker-compose.override.yml';

/** Profiles of the unified project, in the order the Makefile lists them. */
type ComposeProfile = 'core' | 'admin' | 'contest' | 'monitor';

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

/**
 * The `-f` list the Makefile builds with `$(wildcard docker-compose.yml docker-compose.override.yml)`.
 * Mirroring it matters for the override: passing any `-f` disables compose's automatic override
 * merge, so a list without a present override would silently drop the local configuration the rest
 * of the project applies. The override is optional, hence the existence check the wildcard performs.
 * `root` is a parameter so the override branch is testable without writing into the repository.
 */
export async function buildComposeFileFlags(root: string = getRepoRoot()): Promise<string> {
  const hasOverride = await fs
    .access(path.join(root, COMPOSE_OVERRIDE_FILE))
    .then(() => true, () => false);
  return [COMPOSE_BASE_FILE, ...(hasOverride ? [COMPOSE_OVERRIDE_FILE] : [])]
    .map(file => `-f ${file}`)
    .join(' ');
}

/** The compose service a request names, or the request itself when the project does not declare it. */
function asService(requested: string): string {
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
function profilesForServices(services: readonly string[]): readonly ComposeProfile[] {
  const wanted = new Set<ComposeProfile>();
  for (const service of services) {
    const profile = SERVICE_PROFILES[service];
    if (profile) wanted.add(profile);
  }
  if (wanted.has('admin') || wanted.has('contest')) wanted.add('core');
  return PROFILE_ORDER.filter(profile => wanted.has(profile));
}

/** One compose invocation the panel runs, described the way the Makefile's stack targets are. */
interface ComposeRestartTarget {
  /** Profiles the `up` enables, exactly as the matching make target selects them. */
  profiles: readonly ComposeProfile[];
  /** Flags specific to this stack's recreate, in the order the panel already used them. */
  upFlags: readonly string[];
  /** Services both commands are scoped to; empty means the whole enabled stack. */
  services: readonly string[];
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
function servicesForProfiles(profiles: readonly ComposeProfile[]): readonly string[] {
  return scopedServiceList(profiles.flatMap(profile => PROFILE_SERVICES[profile]));
}

const CORE_RESTART: ComposeRestartTarget = {
  profiles: ['core'],
  upFlags: ['--force-recreate'],
  services: servicesForProfiles(['core']),
};

const ADMIN_RESTART: ComposeRestartTarget = {
  profiles: ['core', 'admin'],
  upFlags: ['--force-recreate'],
  services: servicesForProfiles(['core', 'admin']),
};

const CONTEST_RESTART: ComposeRestartTarget = {
  profiles: ['core', 'contest'],
  upFlags: ['--remove-orphans', '--force-recreate'],
  services: servicesForProfiles(['core', 'contest']),
};

/**
 * The stacks an 'all' restart brings up. The worker profile stays out because the fleet lives in
 * per-shard projects (cw<n>) the panel cannot recreate: the container name cms-worker-<shard>
 * already belongs to them, so an `up` here would collide. buildRestartCommand restarts the fleet
 * through scripts/__admin_worker_control.sh instead, as a worker restart already does.
 */
const ALL_RESTART: ComposeRestartTarget = {
  profiles: ['core', 'admin', 'contest', 'monitor'],
  upFlags: [],
  services: servicesForProfiles(['core', 'admin', 'contest', 'monitor']),
};

/**
 * Renders one compose restart for a deployment mode, mirroring the Makefile's stack targets:
 * img pulls then recreates with --no-build, src builds and recreates in one step. Building when
 * the deployment meant to pull is what replaces a registry image with a local build, so the mode —
 * not a hardcoded flag — decides.
 *
 * The pull is best-effort, exactly like the Makefile's `pull || true`: the host may already hold
 * the image the stack should run, and the recreate is what the operator asked for, so a registry
 * outage must not skip it. The pull is parenthesised so `&&` binds to the group — the flat form
 * `pull || true && up` also recreates, but it would swallow a failure of a preceding step (the
 * worker fleet in the 'all' plan) into `true` and still run the compose half against a broken fleet.
 */
function buildComposeRestart(
  target: ComposeRestartTarget,
  files: string,
  mode: DeploymentMode,
  location: HostComposeLocation | null,
): string {
  const profiles = target.profiles.length > 0
    ? ` ${target.profiles.map(profile => `--profile ${profile}`).join(' ')}`
    : '';
  const scope = target.services.length > 0 ? ` ${target.services.join(' ')}` : '';
  // Why: the panel issues this compose from inside its own container, where a relative bind source
  // would otherwise resolve against the container's /repo-root mount — a host path the daemon does
  // not have. Leading the invocation with the host project directory (and the env file that belongs
  // to it) makes the relative binds resolve as they do for the make targets. Empty on the host, so
  // the command stays byte-for-byte what it was.
  const globalFlags = composeLocationFlags(location);
  const invocation = `docker compose ${globalFlags.length > 0 ? `${globalFlags} ` : ''}${files}${profiles}`;
  const recreate = [
    invocation,
    'up -d',
    mode === 'img' ? '--no-build' : '--build',
    ...target.upFlags,
  ].join(' ') + scope;

  if (mode === 'src') {
    return recreate;
  }
  return `(${invocation} pull${scope} || true) && ${recreate}`;
}

async function buildCustomRestartCommand(
  customList: string[],
  files: string,
  mode: DeploymentMode,
  location: HostComposeLocation | null,
): Promise<RestartCommandPlan> {
  const needsContestStack = customList.includes('contest-stack') || customList.some(s => s.startsWith('cms-contest-web-server'));
  // Why: filter keeps only safe service names and strips contest-stack sentinel so docker compose receives valid service identifiers
  const filteredList = customList.filter(s => s !== 'contest-stack' && /^[a-zA-Z0-9_-]+$/.test(s));

  if (filteredList.length === 0 && !needsContestStack) {
    return { skip: true, message: 'Nothing to restart.' };
  }

  const policies = await getRestartPolicies();
  const services = collectContestServices(filteredList, policies);
  const isWorker = (service: string): boolean => /^(?:worker|cms-worker(?:-\d+)?)$/.test(service);
  const workers = services.filter(isWorker);
  // Why the protected services are dropped here too: this list arrives from the caller, so a
  // custom restart naming redis-rate-limit would otherwise reach the container the guard in
  // lib/protected-containers.ts exists to protect.
  const scopedServices = scopedServiceList(services.filter(service => !isWorker(service)).map(asService));
  const commands: string[] = [];
  // A contest-stack recreation previously included workers through the merged
  // files; keep that coverage without handing them to the non-fleet project.
  if (needsContestStack || workers.length > 0) {
    const allWorkers = needsContestStack || workers.some(service => service === 'worker' || service === 'cms-worker');
    commands.push(buildWorkerControlCommand('restart', allWorkers ? [] : workers.map(service => service.slice('cms-worker-'.length))));
  }
  if (needsContestStack) {
    commands.push(buildComposeRestart(CONTEST_RESTART, files, mode, location));
  } else if (scopedServices.length > 0) {
    commands.push(buildComposeRestart(
      { profiles: profilesForServices(scopedServices), upFlags: ['--force-recreate'], services: scopedServices },
      files,
      mode,
      location,
    ));
  }
  // Why an empty plan is a skip and not an empty command: dropping a protected service can leave
  // nothing to act on, and an empty shell string would be executed rather than reported.
  if (commands.length === 0) return { skip: true, message: 'Nothing to restart.' };
  return { skip: false, command: commands.join(' && ') };
}

export async function buildRestartCommand(
  type: 'all' | 'core' | 'admin' | 'worker' | 'custom',
  customList: string[] | undefined,
  files: string,
  mode: DeploymentMode,
  location: HostComposeLocation | null,
): Promise<RestartCommandPlan> {
  if (type === 'core') {
    return { skip: false, command: buildComposeRestart(CORE_RESTART, files, mode, location) };
  }
  if (type === 'admin') {
    return { skip: false, command: buildComposeRestart(ADMIN_RESTART, files, mode, location) };
  }
  if (type === 'worker') {
    return { skip: false, command: buildWorkerControlCommand('restart') };
  }
  if (type === 'custom' && customList && customList.length > 0) {
    return buildCustomRestartCommand(customList, files, mode, location);
  }
  const workerCommand = buildWorkerControlCommand('restart');
  const composeRestart = buildComposeRestart(ALL_RESTART, files, mode, location);
  return { skip: false, command: `${workerCommand} && ${composeRestart}` };
}
