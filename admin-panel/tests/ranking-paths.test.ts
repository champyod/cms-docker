import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HOST_ASSETS_CONFIG_DIR, hostAssetsDir, rankingAvatarDir, rankingLibDir } from '@/lib/ranking-paths';
import { getRepoRoot } from '@/lib/repo-root';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ranking paths', () => {
  it('defaults to the image layout when the key is absent', () => {
    vi.stubEnv('CMS_RANKING_LIB_DIR', '');

    expect(rankingLibDir()).toBe('/var/local/lib/cms/ranking');
  });

  it('takes the directory from the delivered config key', () => {
    vi.stubEnv('CMS_RANKING_LIB_DIR', '/srv/ranking');

    expect(rankingLibDir()).toBe('/srv/ranking');
    expect(rankingAvatarDir()).toBe('/srv/ranking/avatars');
  });

  it('resolves the host mirror and its config.toml spelling from one relative directory', () => {
    expect(hostAssetsDir()).toBe(path.join(getRepoRoot(), 'config/assets'));
    expect(HOST_ASSETS_CONFIG_DIR).toBe('./config/assets');
  });
});
