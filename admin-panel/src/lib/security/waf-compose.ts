import { composeLocationFlags, type HostComposeLocation } from '@/lib/compose-location';
import type { DeploymentMode } from '@/lib/deployment-mode';

export const WAF_DOMAIN_COMPOSE_FILE = 'docker-compose.domain.yml';
export const WAF_COMPOSE_FILE = 'docker-compose.waf.yml';
export const WAF_CORE_PROFILE = 'core';
export const WAF_PROFILE = 'waf';
export const WAF_SERVICE = 'grader-waf';

/**
 * Same three files and two profiles as the Makefile's `waf` target (WAF_COMPOSE_FLAGS,
 * WAF_UP_PROFILES). The domain file is required: grader-waf declares depends_on
 * grader-nginx-proxy, so compose rejects the project without it.
 */
const WAF_COMPOSE_SUFFIX =
  ` -f ${WAF_DOMAIN_COMPOSE_FILE} -f ${WAF_COMPOSE_FILE} --profile ${WAF_CORE_PROFILE} --profile ${WAF_PROFILE}`;

export function buildWafRecreateCommand(
  files: string,
  mode: DeploymentMode,
  location: HostComposeLocation | null,
): string {
  const globalFlags = composeLocationFlags(location);
  const prefix = `docker compose ${globalFlags.length > 0 ? `${globalFlags} ` : ''}${files}${WAF_COMPOSE_SUFFIX}`;
  const recreate = `${prefix} up -d ${mode === 'img' ? '--no-build' : '--build'} --force-recreate ${WAF_SERVICE}`;
  return mode === 'src' ? recreate : `(${prefix} pull ${WAF_SERVICE} || true) && ${recreate}`;
}

/** Restart only, for a CRS threshold change: the mounted crs-setup.conf is re-read on start. */
export function buildWafRestartCommand(): string {
  return `docker restart ${WAF_SERVICE}`;
}
