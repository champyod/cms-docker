import fs from 'fs/promises';
import path from 'path';

import { getRepoRoot } from '@/lib/repo-root';

/**
 * The lines the config sync publishes for the front's own vhosts: each `label|hostname|paths` when a
 * route row owns the vhost, and a bare hostname when the front declares it outside the table.
 *
 * WHY one file and not the rendered config too: the sync is the only reader of that config, so having
 * the panel parse `server_name` out of it gave one fact two extractors to drift apart — and the sync
 * now writes both kinds of line into this file, which is what the renderer is already handed.
 */
export const FRONT_VHOSTS_FILE = 'config/generated/front-vhosts.txt';

/** The entries the config sync wrote, in the order it wrote them. */
export function parseFrontVhostMap(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** The front's own vhosts as the sync published them, or [] when the sync has never written the file. */
export async function readFrontVhosts(root: string = getRepoRoot()): Promise<string[]> {
  const published = await fs.readFile(path.join(root, FRONT_VHOSTS_FILE), 'utf-8').catch(() => null);
  return published === null ? [] : parseFrontVhostMap(published);
}
