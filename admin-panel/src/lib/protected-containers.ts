import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

/**
 * Containers the admin panel may show but never control.
 *
 * Why a hard list and not a permission: the TLS terminator, the certificate loop,
 * the key store and the rate-limit store are the security boundary of the
 * deployment. `container:control` is held by the Storage Admin group and expands
 * out of `all:all`, so any permission-based rule would still let an admin account
 * silently stop TLS termination or empty the key store. These names are therefore
 * refused by every path that addresses a container by id — controlContainer,
 * updateContainerConfig and resetRestartCount — regardless of the caller's
 * effective permissions, and the refusal is recorded.
 *
 * Why grader-waf is no longer here: the WAF is reached through its own keys
 * (waf:control, waf:config) and its own scoped compose invocation
 * (lib/security/waf-compose.ts), which recreates that one service and no other. A
 * name-based refusal cannot tell a WAF change from a TLS change, so that boundary
 * moved to the scope of the action instead of the name list.
 *
 * A stack action addresses a compose service rather than a container, so this
 * guard has no id to resolve and cannot see one. That half is covered separately,
 * by excluding the protected service from every compose scope
 * (PROTECTED_COMPOSE_SERVICES in lib/compose-command.ts).
 *
 * Matched on container name, not compose service: the two proxies are distinct
 * services now — grader-nginx-proxy (domain.yml) and nginx-proxy
 * (docker-compose.yml) — but only the container name is stable across a rename,
 * and `docker inspect` returns container names. Pinning the TLS terminator must
 * not pin the contest front (cms-nginx-contest), which stays controllable.
 *
 * Scope, so this is not mistaken for more than it is:
 * - The panel is the boundary. The admin-panel container mounts the Docker socket
 *   read-write (docker-compose.yml:462-464), so code inside it is root-equivalent and this
 *   guard does not constrain that. It bounds what the panel's own actions do, which is what
 *   was asked for.
 * - The by-id refusal resolves the name and then acts, so the two docker calls are not
 *   atomic. The panel exposes no rename action, and a container renamed by other means would
 *   be acted on under whatever name the second call resolves.
 * - Host-side make targets are out of scope. `make contest` (Makefile:132) runs an unscoped
 *   `up -d`, so an operator on the host can still recreate grader-redis-rate-limit; that
 *   operator already holds the socket.
 */
export const PROTECTED_CONTAINER_NAMES: readonly string[] = [
  'grader-nginx-proxy',
  'grader-certbot',
  'grader-redis-rate-limit',
  'grader-hsm',
  'grader-vault-inline',
];

const PROTECTED_CONTAINERS: ReadonlySet<string> = new Set(PROTECTED_CONTAINER_NAMES);

export const PROTECTED_CONTAINER_ERROR =
  'This container is part of the platform security boundary and cannot be controlled from the admin panel. Use the host CLI (make domain).';

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
