import fs from 'fs/promises';
import path from 'path';

import { getRepoRoot } from '@/lib/repo-root';

/**
 * The hostnames the deployment's own front already declares, and the fragment file each one includes.
 *
 * WHY the sync's map and the rendered config together: the map is the route table's own
 * `label|hostname` view, so it names the `locations-<label>.conf` file a vhost pulls in, and the
 * rendered config answers with the names nginx itself will claim, whatever fallbacks produced them.
 * A name only the config knows is one no route row owns. Either file missing means the front has
 * never been rendered, so nothing collides yet.
 */
export const FRONT_CONFIG_FILE = 'config/grader.nginx.conf';

/** The map the config sync writes beside the fragments it renders. */
export const FRONT_VHOST_MAP_FILE = 'config/generated/front-vhosts.txt';

const SERVER_NAME_LINE = /^\s*server_name\s+([^;]+);/gm;

/** Every hostname a server block in the rendered front declares, lower-cased and deduplicated. */
export function parseFrontVhosts(content: string): string[] {
  const names = new Set<string>();
  for (const match of content.matchAll(SERVER_NAME_LINE)) {
    for (const name of match[1].trim().split(/\s+/)) {
      const hostname = name.trim().toLowerCase();
      if (hostname !== '') names.add(hostname);
    }
  }
  return [...names];
}

/** The `label|hostname` entries the config sync wrote, in the order it wrote them. */
export function parseFrontVhostMap(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * The front's own vhosts for the renderer and the screen: the labelled entries first, so a label
 * wins over a bare duplicate, then the names only the rendered config knows.
 */
export async function readFrontVhosts(root: string = getRepoRoot()): Promise<string[]> {
  const [map, config] = await Promise.all([
    fs.readFile(path.join(root, FRONT_VHOST_MAP_FILE), 'utf-8').catch(() => null),
    fs.readFile(path.join(root, FRONT_CONFIG_FILE), 'utf-8').catch(() => null),
  ]);
  return [
    ...(map === null ? [] : parseFrontVhostMap(map)),
    ...(config === null ? [] : parseFrontVhosts(config)),
  ];
}
