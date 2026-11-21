import path from 'path';

import { getRepoRoot } from '@/lib/repo-root';

/**
 * The one place the panel resolves where a ranking asset lives.
 *
 * WHY the directory comes from the environment and not a literal: `CMS_RANKING_LIB_DIR` is the
 * config.toml [admin] key that config sync renders into .env, and compose hands it to this
 * container. A literal here drifts from the value the volume and the ranking service are built
 * from, which is exactly how the logo came to be written to a second spelling of the same path.
 */
const RANKING_LIB_DIR_ENV = 'CMS_RANKING_LIB_DIR';

/** The image-layout default, used only when the environment does not carry the key. */
const DEFAULT_RANKING_LIB_DIR = '/var/local/lib/cms/ranking';

/** The host mirror the panel keeps beside the volume copy, relative to the repo root. */
const HOST_ASSETS_DIR = 'config/assets';

/** The directory the panel writes ranking assets into and the service reads them from. */
export function rankingLibDir(): string {
  return process.env[RANKING_LIB_DIR_ENV] || DEFAULT_RANKING_LIB_DIR;
}

/** The directory the service reads contestant faces from; a child of the ranking directory. */
export function rankingAvatarDir(): string {
  return path.join(rankingLibDir(), 'avatars');
}

/** The host mirror of the uploaded logo, beside the repo's config directory. */
export function hostAssetsDir(): string {
  return path.join(getRepoRoot(), HOST_ASSETS_DIR);
}

/** The repo-relative spelling config.toml records for the logo, as config.toml.example documents it. */
export const HOST_ASSETS_CONFIG_DIR = `./${HOST_ASSETS_DIR}`;
