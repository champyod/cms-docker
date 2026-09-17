import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import util from 'util';

import { getRepoRoot, isContainerised } from './repo-root';

const execPromise = util.promisify(exec);

/** The panel's own service, as docker-compose.yml pins it with `container_name`. */
const PANEL_CONTAINER = 'cms-admin-panel-next';

/** Destination of the repo bind mount docker-compose.yml gives the panel (`- ./:/repo-root`). */
const REPO_MOUNT_DESTINATION = '/repo-root';

/** The file `./cms config sync` writes into the repo and both the Makefile and compose read. */
const ENV_FILE = '.env';

/** The host side of the panel's repo mount. */
export interface HostComposeLocation {
  /** Host directory holding docker-compose.yml, which relative bind sources must resolve against. */
  projectDirectory: string;
  /** The repo's env file as this process sees it, or null when the deployment generated none. */
  envFile: string | null;
}

export type ComposeLocationResolution =
  | { ok: true; location: HostComposeLocation | null }
  | { ok: false; error: string };

/**
 * The source of the mount whose destination is `destination`, out of a `docker inspect` listing
 * rendered as one "source destination" pair per line. Anchoring on the destination — a path this
 * project fixes — instead of splitting the line on whitespace is what keeps a host repository path
 * containing spaces in one piece.
 */
export function parseMountSource(inspectOutput: string, destination: string): string | null {
  const suffix = ` ${destination}`;
  for (const line of inspectOutput.split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed.endsWith(suffix)) return trimmed.slice(0, -suffix.length);
  }
  return null;
}

/**
 * The paths compose has to be given when the panel runs it from inside its container, or null when
 * this process already runs where the daemon does.
 *
 * Why the container needs them: docker-compose.yml mounts the repo into the panel at /repo-root and
 * mounts host files into other services with relative paths (`./scripts/__backup.sh:/usr/local/bin/
 * cms-backup.sh:ro`). A relative bind source is resolved against the compose project directory and
 * handed to the daemon as a HOST path, so from the container it became `/repo-root/scripts/...` —
 * a path that exists nowhere on the host, which the daemon then creates as a directory and refuses
 * to mount onto a file. The host repository path is recorded in exactly one place: the source of the
 * panel's own /repo-root mount.
 *
 * Why the env file comes with it: `--project-directory` also moves where compose looks for `.env`
 * (it belongs to the project directory), and that path is unreadable from inside the container. Left
 * alone, the project would lose COMPOSE_PROJECT_NAME — compose would name the project after the host
 * directory instead, so `up` would meet the running containers' names as conflicts — and every
 * `${...}` in the compose file would fall back to its default. `--env-file` pointed at the same file
 * this process can read restores both, which is how the Makefile already invokes compose.
 *
 * Refuses rather than guesses when the mount cannot be read: a wrong project directory lets compose
 * mount whatever happens to sit at that path on the host, so containers would run against the wrong
 * files instead of failing — the same class of damage the relative paths caused in the first place.
 */
export async function resolveHostComposeLocation(): Promise<ComposeLocationResolution> {
  if (!isContainerised()) return { ok: true, location: null };

  let stdout: string;
  try {
    ({ stdout } = await execPromise(
      `docker inspect ${PANEL_CONTAINER} --format '{{range .Mounts}}{{.Source}} {{.Destination}}{{println}}{{end}}'`,
    ));
  } catch (error) {
    return {
      ok: false,
      error: `Cannot determine the host repository path: docker inspect ${PANEL_CONTAINER} failed (${(error as Error).message}).`,
    };
  }

  const projectDirectory = parseMountSource(stdout, REPO_MOUNT_DESTINATION);
  if (projectDirectory === null) {
    return {
      ok: false,
      error: `Cannot determine the host repository path: container ${PANEL_CONTAINER} has no ${REPO_MOUNT_DESTINATION} mount.`,
    };
  }

  const envFile = path.join(getRepoRoot(), ENV_FILE);
  const hasEnvFile = await fs.access(envFile).then(() => true, () => false);
  return { ok: true, location: { projectDirectory, envFile: hasEnvFile ? envFile : null } };
}

/**
 * The location as the global flags of a compose command string, or '' when there is nothing to add.
 * Paths are quoted because the panel's shell would otherwise split a repository path with a space in
 * it, silently pointing compose at a different directory.
 */
export function composeLocationFlags(location: HostComposeLocation | null): string {
  if (location === null) return '';
  const flags = [`--project-directory ${quoteForShell(location.projectDirectory)}`];
  if (location.envFile !== null) flags.push(`--env-file ${quoteForShell(location.envFile)}`);
  return flags.join(' ');
}

/**
 * The same location as separate arguments, for the deploys that spawn compose without a shell and so
 * need no quoting.
 */
export function composeLocationArguments(location: HostComposeLocation | null): string[] {
  if (location === null) return [];
  const args = ['--project-directory', location.projectDirectory];
  if (location.envFile !== null) args.push('--env-file', location.envFile);
  return args;
}

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
