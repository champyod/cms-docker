import { composeLocationFlags, type HostComposeLocation } from '@/lib/compose-location';
import { scopedServiceList } from '@/lib/compose-command';
import type { DeploymentMode } from '@/lib/deployment-mode';

/** The profiles the Makefile's contest target enables; core comes with contest for depends_on validation. */
const CONTEST_PROFILES = ['--profile', 'core', '--profile', 'contest'];

/** The contest stack's own services, which are also what the retired per-stack file contained. */
const CONTEST_SERVICES = ['evaluation-service', 'proxy-service', 'contest-web-server', 'nginx-proxy'];

/**
 * Everything the compose invocation needs, resolved by the caller the same way a restart resolves it
 * (see `restartServices`): the `-f` list, the deployment mode and the host location. Passing it in
 * rather than resolving it here keeps the deploy on the same project the make targets and the
 * restarts run, instead of a second opinion about which files and flags are canonical.
 */
export interface ContestDeployPlan {
  files: string;
  mode: DeploymentMode;
  location: HostComposeLocation | null;
}

/**
 * The contest stack as the project's own entry points bring it up: the unified project (the `-f` list
 * the Makefile's wildcard builds and the restart path passes), the core and contest profiles, and the
 * deployment mode deciding pull + `--no-build` versus `--build`.
 *
 * Why not the per-stack `docker-compose.contest.yml` this used to run: that file declares no image
 * names, so compose derives `<project>-<service>` images nothing else in the project builds or pulls —
 * an image-mode pull against them cannot succeed, and a source build leaves the running stack on
 * images the rest of the project never touches. `lib/restart-planner.ts` was just fixed for exactly
 * this defect; this mirrors it rather than inventing a second convention (the shared home would be
 * that file, which another change owns).
 *
 * Why the four contest services stay the scope: `--force-recreate` applies to the services named, and
 * the contest stack carries core in its profiles for depends_on validation — naming the scope keeps
 * activating a contest from restarting the database.
 */
export function buildContestDeployCommand(plan: ContestDeployPlan): string {
  const invocation = ['docker', 'compose', composeLocationFlags(plan.location), plan.files, CONTEST_PROFILES.join(' ')]
    .filter((part) => part.length > 0)
    .join(' ');
  // Why the scope is filtered through the shared list: this is a third copy of the contest stack's
  // services, and naming a protected one here would reach its container without any guard seeing it.
  const scope = scopedServiceList(CONTEST_SERVICES).join(' ');
  const recreate = `${invocation} up -d ${plan.mode === 'src' ? '--build' : '--no-build'} --force-recreate ${scope}`;
  // Refresh nginx after the web server is recreated (stale upstream DNS).
  // Single source of truth: scripts/__contest_dns_refresh.sh.
  const refreshed = `${recreate} && bash scripts/__contest_dns_refresh.sh`;
  // Best-effort pull, exactly like the Makefile's `pull || true`: the host may already hold the image
  // this deployment runs, and the recreate is what the operator asked for.
  return plan.mode === 'src' ? refreshed : `(${invocation} pull ${scope} || true) && ${refreshed}`;
}

/**
 * The shell script the deploy runs: the command, then the deploy's own report of how it ended.
 *
 * Why the script writes the markers rather than the panel's `close` handler: the marker is the only
 * evidence of an outcome, and the panel can restart — or its container be recreated — while the build
 * runs. The detached child survives that; the handler that was going to write the marker does not, and
 * the deploy would then finish with nothing to record it. The marker paths arrive as `$1`/`$2` (argv,
 * not interpolation) so a repository path containing spaces cannot break the script.
 */
export function buildDeployScript(command: string): string {
  return [
    `(${command})`,
    'code=$?',
    'if [ "$code" -eq 0 ]; then',
    '  printf \'%s\' "$code" > "$1"',
    'else',
    '  printf \'%s\' "$code" > "$2"',
    'fi',
    'exit "$code"',
  ].join('\n');
}
