import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readFrontVhosts } from '@/lib/front-vhosts';

const roots: string[] = [];

async function repoWith(lines: string | null): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'cms-front-vhosts-'));
  roots.push(root);
  if (lines === null) return root;
  await mkdir(path.join(root, 'config/generated'), { recursive: true });
  await writeFile(path.join(root, 'config/generated/front-vhosts.txt'), lines);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('readFrontVhosts', () => {
  it('reads the labelled entries and the bare hostnames the sync published', async () => {
    const root = await repoWith('primary|cms.mwit.ac.th|/ /admin\nadmin.cms.mwit.ac.th\n');
    expect(await readFrontVhosts(root)).toEqual(['primary|cms.mwit.ac.th|/ /admin', 'admin.cms.mwit.ac.th']);
  });

  it('reads nothing when the sync has never written the file', async () => {
    expect(await readFrontVhosts(await repoWith(null))).toEqual([]);
  });
});
