import { composeLocationFlags, type HostComposeLocation } from './compose-location';
import type { DeploymentMode } from './deployment-mode';

export type ComposeAction = 'up' | 'down' | 'restart' | 'build';
export type ComposeService = 'core' | 'admin' | 'contest' | 'worker';

export function buildWorkerControlCommand(action: 'start' | 'stop' | 'restart', shards: string[] = []): string {
  if (!shards.every(shard => /^\d+$/.test(shard))) {
    throw new Error('Invalid worker shard');
  }
  return ['bash scripts/__admin_worker_control.sh', action, ...shards].join(' ');
}

/**
 * What a compose invocation needs besides the action. Passed in rather than resolved here because
 * resolving is I/O while this module only renders the command; the callers resolve the three parts
 * exactly as the restart and deploy paths do (see `app/actions/services.ts`).
 */
export interface ComposeInvocation {
  /** The `-f` list of the unified project, from `buildComposeFileFlags()`. */
  files: string;
  /** Decides whether an `up` pulls and skips the build, or builds from source. */
  mode: DeploymentMode;
  /** Host paths compose needs when the panel runs in its own container; null when it runs on the host. */
  location: HostComposeLocation | null;
}

/** Profiles of the unified project, in the order the Makefile's targets select them. */
const PROFILE_ORDER = ['core', 'admin', 'contest', 'worker'] as const;
type ComposeProfile = typeof PROFILE_ORDER[number];

/**
 * Profiles each stack needs, as the Makefile's `core`/`admin`/`contest` targets select them: core
 * comes with admin and contest because compose rejects a project whose profile-gated service depends
 * on one the enabled profiles do not expose ("service ranking-web-server depends on undefined service
 * database" — checked with `docker compose --profile admin config`). The worker stack is its own
 * profile and part of no other.
 */
const STACK_PROFILES: Readonly<Record<ComposeService, readonly ComposeProfile[]>> = {
  core: ['core'],
  admin: ['core', 'admin'],
  contest: ['core', 'contest'],
  worker: ['worker'],
};

/** The stacks an 'all' request covers: every stack this panel offers a button for. */
const ALL_STACKS: readonly ComposeService[] = ['core', 'admin', 'contest'];

/**
 * The services each stack owns, mirroring the Makefile's ADMIN_SERVICES/CONTEST_SERVICES. Naming
 * them is what keeps an operation scoped: core is enabled next to admin and contest for depends_on
 * validation only, so an unscoped `down`, `restart` or `build` would reach the database.
 */
const STACK_SERVICES: Readonly<Record<ComposeService, readonly string[]>> = {
  core: [],
  admin: ['admin-panel-next', 'admin-web-server', 'ranking-web-server'],
  contest: ['evaluation-service', 'proxy-service', 'contest-web-server', 'nginx-proxy'],
  worker: [],
};

const COMPOSE_ACTIONS: readonly string[] = ['up', 'down', 'restart', 'build'];
const COMPOSE_SERVICES: readonly string[] = ['core', 'admin', 'contest', 'worker'];

/** The `--profile` list of these stacks, deduplicated in the Makefile's order. */
function profilesFor(stacks: readonly ComposeService[]): string {
  const wanted = new Set<ComposeProfile>();
  for (const stack of stacks) {
    for (const profile of STACK_PROFILES[stack]) wanted.add(profile);
  }
  return PROFILE_ORDER.filter(profile => wanted.has(profile)).map(profile => `--profile ${profile}`).join(' ');
}

/**
 * The service list the action is scoped to, or '' when the whole enabled stack is meant. An 'up' is
 * never scoped because it mirrors the matching make target (`make admin` brings up what admin needs);
 * the other actions are, and a stack with no list of its own (core) covers its entire profile, so the
 * union keeps no scope at all rather than naming the profile's services one by one.
 */
function serviceScope(action: ComposeAction, stacks: readonly ComposeService[]): string {
  if (action === 'up') return '';
  if (stacks.some(stack => STACK_SERVICES[stack].length === 0)) return '';
  return stacks.flatMap(stack => STACK_SERVICES[stack]).join(' ');
}

/**
 * One compose invocation of the unified project, mirroring the Makefile's stack targets.
 *
 * Why `up` follows the mode: `img` deployments run registry images, so the recreate must not build
 * (and must pull first, best effort, exactly like the Makefile's `pull || true`), while `src` builds
 * from source. Building when the deployment meant to pull replaces a registry image with a local one.
 */
function buildStackCommand(action: ComposeAction, stacks: readonly ComposeService[], invocation: ComposeInvocation): string {
  // Why the location leads the invocation: from inside the panel container a relative bind source in
  // docker-compose.yml would resolve against the container's /repo-root mount — a host path the daemon
  // does not have (see compose-location.ts). Empty on the host, so the command stays as it was.
  const base = ['docker compose', composeLocationFlags(invocation.location), invocation.files, profilesFor(stacks)]
    .filter(part => part.length > 0)
    .join(' ');
  const scope = serviceScope(action, stacks);
  const scoped = scope.length > 0 ? ` ${scope}` : '';

  if (action === 'up') {
    const recreate = `${base} up -d ${invocation.mode === 'src' ? '--build' : '--no-build'}`;
    const refreshed = stacks.includes('contest')
      ? `${recreate} && bash scripts/__contest_dns_refresh.sh`
      : recreate;
    return invocation.mode === 'src' ? refreshed : `(${base} pull || true) && ${refreshed}`;
  }
  // An explicit build request is a full rebuild from the current source, so it neither pulls nor
  // takes the mode: the operator asked for a local image, whatever the deployment otherwise runs.
  if (action === 'build') return `${base} build --no-cache${scoped}`;
  return `${base} ${action}${scoped}`;
}

/**
 * The composite command behind the Containers page's stack controls: the unified project the make
 * targets and the deploy path run, so the page, the restart planner and a deploy cannot disagree
 * about which services or images they mean. The partial `docker-compose.<stack>.yml` files this used
 * to assemble are not that project: each describes one stack in isolation, and the images they name
 * are derived from the project name (`cms-admin-panel-next`, `<project>-log-service`) — none of them
 * published, so an image-mode pull could only fail and a source build tagged images nothing else uses.
 *
 * The runtime checks are not redundant with the types: these values arrive from the browser through a
 * server action.
 */
export function buildComposeCommand(
  action: ComposeAction,
  serviceType: ComposeService | undefined,
  invocation: ComposeInvocation,
): string {
  if (!COMPOSE_ACTIONS.includes(action) ||
      (serviceType !== undefined && !COMPOSE_SERVICES.includes(serviceType))) {
    throw new Error('Invalid compose action or service');
  }
  const includesWorkers = serviceType === undefined || serviceType === 'worker';
  // The panel's repository mount is not a host path. Keep existing fleet mounts
  // and ownership rather than recreating workers from a foreign compose project.
  if (includesWorkers && action === 'build') {
    throw new Error('Build workers with make worker on the host; the panel can only start, stop, or restart existing fleet containers.');
  }
  const workerCommand = buildWorkerControlCommand(action === 'up' ? 'start' : action === 'down' ? 'stop' : 'restart');
  if (serviceType === 'worker') return workerCommand;

  const stacks: readonly ComposeService[] = serviceType === undefined ? ALL_STACKS : [serviceType];
  const composeCommand = buildStackCommand(action, stacks, invocation);
  return includesWorkers ? `${workerCommand} && ${composeCommand}` : composeCommand;
}
