import fs from 'fs/promises';
import path from 'path';
import { getRepoRoot } from '@/lib/repo-root';
import { CONFIG_TOML_FILE } from '@/lib/config-toml';
import { parseDeploymentMode, type DeploymentModeSetting } from '@/lib/deployment-mode';

/**
 * The mode the deployment runs in, read from config.toml — the source of truth the settings screens
 * read — and not from process.env, which only carries the value a previous `./cms config sync` copied
 * into .env and can therefore lag an edit. A missing file is the same "cannot be determined" case as
 * an unknown value; both fall back to img, the mode that does not rebuild (see deployment-mode.ts).
 *
 * Why this sits beside deployment-mode.ts instead of in it: that module's parser is imported by a
 * client component, and this one reads the filesystem. Keep it out of the bundler's `server-only`
 * marker as well, so the restart, deploy and rebuild paths can share one reader without every test
 * having to mock the marker.
 *
 * `root` is a parameter so the reader is testable without writing into the repository.
 */
export async function readDeploymentModeSetting(root: string = getRepoRoot()): Promise<DeploymentModeSetting> {
  const content = await fs
    .readFile(path.join(root, CONFIG_TOML_FILE), 'utf-8')
    .catch(() => null);
  return parseDeploymentMode(content);
}
