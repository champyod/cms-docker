import fs from 'fs/promises';
import path from 'path';

import { getRepoRoot } from '@/lib/repo-root';

/**
 * The hostnames the deployment's own front already declares.
 *
 * WHY the rendered config and not config.toml: the front's server blocks come from
 * config/grader.nginx.conf.template, which envsubst fills from the [admin]/[core]/[contest]
 * domain keys — reading the rendered file answers with the names nginx itself will claim,
 * whatever the fallback chain did to produce them, and no second reader has to repeat that
 * chain. A missing file means the front has never been rendered, so nothing collides yet.
 */
export const FRONT_CONFIG_FILE = 'config/grader.nginx.conf';

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

export async function readFrontVhosts(root: string = getRepoRoot()): Promise<string[]> {
  const content = await fs
    .readFile(path.join(root, FRONT_CONFIG_FILE), 'utf-8')
    .catch(() => null);
  return content === null ? [] : parseFrontVhosts(content);
}
