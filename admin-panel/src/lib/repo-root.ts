import path from 'path';

/**
 * Whether this process runs inside the panel's own container. docker-compose.yml sets IS_DOCKER for
 * that service, and the answer decides two things beyond the repo path: in the container the repo is
 * a bind mount, so a compose command issued here has to be told the host's paths (see
 * compose-location.ts), while a panel started on the host runs where the make targets do.
 */
export const isContainerised = (): boolean => process.env.IS_DOCKER === 'true';

export const getRepoRoot = (): string =>
  isContainerised() ? '/repo-root' : path.resolve(process.cwd(), '..');
