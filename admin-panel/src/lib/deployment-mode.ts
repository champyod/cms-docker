import { extractConfigTomlValues, type ConfigTomlKey } from '@/lib/config-toml';

/**
 * The two modes `config.toml [admin] DEPLOYMENT_TYPE` declares and the Makefile's stack targets
 * branch on: `img` pulls the registry image then recreates without building, `src` builds from the
 * local source. They are not interchangeable — a src build overwrites a pulled image with a local
 * one — so every restart has to know which one the deployment is supposed to be running.
 */
export type DeploymentMode = 'img' | 'src';

export interface DeploymentModeSetting {
  mode: DeploymentMode;
  /** false when config.toml is unreadable or carries no known DEPLOYMENT_TYPE value. */
  resolved: boolean;
}

const DEPLOYMENT_TYPE_KEY: ConfigTomlKey = { section: 'admin', key: 'DEPLOYMENT_TYPE' };

/**
 * Decodes the raw line tail the panel's config.toml reader returns: it keeps the quotes AND the
 * inline comment (`"img"         # enum:img,src` — the exact shape of the declared key in
 * config.toml.example, which a fresh deployment copies verbatim). Both shapes are what the sync
 * script's own parser decodes, so one layer of quotes comes off and an unquoted value stops at `#`.
 */
function decodeTomlScalar(raw: string): string {
  const value = raw.trim();
  const quote = value.charAt(0);
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1);
    return end === -1 ? value.slice(1) : value.slice(1, end);
  }
  const comment = value.indexOf('#');
  return comment === -1 ? value : value.slice(0, comment).trim();
}

/**
 * The mode assumed when config.toml cannot answer.
 *
 * Why img: it is the same fallback the Makefile applies when .env has no DEPLOYMENT_TYPE
 * (`DEPLOY_TYPE=${DEPLOY_TYPE:-img}`), and it is the non-destructive direction — img only pulls the
 * image the deployment already runs, so a wrong guess costs a pull and a recreate, while guessing
 * src would silently replace a pulled registry image with a local build. The cost of being wrong is
 * therefore a failed pull (visible) instead of an unreproducible image (invisible).
 */
export const FALLBACK_DEPLOYMENT_MODE: DeploymentMode = 'img';

/**
 * Reads the mode from config.toml content, the source `./cms config sync` regenerates .env from and
 * the file the settings screens already read. Uses the panel's section-scoped reader so a
 * same-named key in another section cannot be picked up, and returns FALLBACK_DEPLOYMENT_MODE with
 * `resolved: false` for a missing, empty or unrecognised value instead of throwing: the restart
 * still has to run, and the UI has to be able to say the mode was assumed.
 */
export function parseDeploymentMode(content: string | null): DeploymentModeSetting {
  const raw = content === null
    ? ''
    : extractConfigTomlValues(content, [DEPLOYMENT_TYPE_KEY])[DEPLOYMENT_TYPE_KEY.key];
  const value = decodeTomlScalar(raw ?? '').toLowerCase();
  if (value === 'img' || value === 'src') {
    return { mode: value, resolved: true };
  }
  return { mode: FALLBACK_DEPLOYMENT_MODE, resolved: false };
}

/**
 * Which `settings.deploymentMode` entry describes a restart for this setting. An assumed mode gets
 * its own entry rather than the img wording: the operator has to be able to tell "this deployment
 * pulls" from "the panel could not read the mode and will pull anyway".
 */
export function deploymentModeCopyKey(setting: DeploymentModeSetting): 'img' | 'src' | 'unresolved' {
  return setting.resolved ? setting.mode : 'unresolved';
}
