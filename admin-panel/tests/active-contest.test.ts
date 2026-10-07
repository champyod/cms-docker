import { describe, expect, it } from 'vitest';

import { readContestId, setContestId } from '@/lib/active-contest';

const TOML = [
  '# config.toml — single source of truth',
  '[core]',
  'CMS_DOMAIN = "cms.local"',
  '',
  '[contest]',
  'CONTEST_ID = 1                  # num; active contest',
  'CONTEST_LISTEN_PORT = 8888',
  '',
  '[worker]',
  'WORKER_PORT = 26000',
  '',
].join('\n');

describe('active contest in config.toml', () => {
  it('reads CONTEST_ID from [contest], ignoring the inline comment', () => {
    expect(readContestId(TOML)).toBe(1);
  });

  it('tolerates the quoted form the TOML writer emits', () => {
    expect(readContestId('[contest]\nCONTEST_ID = "3"\n')).toBe(3);
  });

  it('returns null when CONTEST_ID is absent', () => {
    expect(readContestId('[contest]\nCONTEST_LISTEN_PORT = 8888\n')).toBeNull();
  });

  it('does not pick up a same-named key outside [contest]', () => {
    expect(readContestId('[core]\nCONTEST_ID = 5\n')).toBeNull();
  });

  it('replaces the id in [contest] and leaves other sections untouched', () => {
    const updated = setContestId(TOML, 7);
    expect(readContestId(updated)).toBe(7);
    expect(updated).toContain('CMS_DOMAIN = "cms.local"');
    expect(updated).toContain('CONTEST_LISTEN_PORT = 8888');
    expect(updated).toContain('WORKER_PORT = 26000');
    expect(updated).toContain('# num; active contest');
  });

  it('inserts CONTEST_ID when the [contest] section exists without it', () => {
    const updated = setContestId('[contest]\nCONTEST_LISTEN_PORT = 8888\n', 4);
    expect(readContestId(updated)).toBe(4);
    expect(updated).toContain('CONTEST_LISTEN_PORT = 8888');
  });

  it('round-trips any id', () => {
    expect(readContestId(setContestId(TOML, 42))).toBe(42);
  });
});
