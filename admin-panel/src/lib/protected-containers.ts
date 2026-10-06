import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

/**
 * Containers the admin panel may show but never control.
 *
 * Why a hard list and not a permission: the WAF, the TLS terminator and the
 * certificate loop are the security boundary of the deployment. `container:control`
 * is held by the Storage Admin group and expands out of `all:all`, so any
 * permission-based rule would still let an admin account silently stop request
 * filtering or TLS termination. These names are therefore refused by every path
 * that addresses a container by id — controlContainer, updateContainerConfig and
 * resetRestartCount — regardless of the caller's effective permissions, and the
 * refusal is recorded.
 *
 * A stack action addresses a compose service rather than a container, so this
 * guard has no id to resolve and cannot see one. That half is covered separately,
 * by excluding the protected service from every compose scope
 * (PROTECTED_COMPOSE_SERVICES in lib/compose-command.ts).
 *
 * Matched on container name, not compose service: docker-compose.yml and
 * docker-compose.domain.yml both declare a service named `nginx-proxy`, so a
 * service-name match would also pin the contest front (cms-nginx-contest).
 */
export const PROTECTED_CONTAINER_NAMES: readonly string[] = [
  'grader-waf',
  'grader-nginx-proxy',
  'grader-certbot',
  'grader-redis-rate-limit',
  'grader-hsm',
  'grader-vault-inline',
];

const PROTECTED_CONTAINERS: ReadonlySet<string> = new Set(PROTECTED_CONTAINER_NAMES);

export const PROTECTED_CONTAINER_ERROR =
  'This container is part of the platform security boundary and cannot be controlled from the admin panel. Use the host CLI (make waf / make domain).';

export function isProtectedContainerName(name: string): boolean {
  return PROTECTED_CONTAINERS.has(name.replace(/^\//, ''));
}

/**
 * Resolves the name behind a container id and reports whether it is protected.
 *
 * Throws when docker cannot be inspected; every caller turns that into a
 * refusal, so an unidentifiable container is never controlled (fail closed).
 */
export async function isProtectedContainerId(id: string): Promise<boolean> {
  const { stdout } = await execPromise(`docker inspect ${id} --format '{{.Name}}'`);
  return isProtectedContainerName(stdout.trim());
}
