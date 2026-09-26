import type { ConfigTomlKey } from '@/lib/config-toml';

/**
 * The contest settings the Deployments screen edits, all in config.toml [contest].
 *
 * Why they used to be read from and written to .env.contest: compose never loads that file and no
 * script generates it, so the write never reached the running stack and no config sync could have
 * kept it. Declaring the keys in their own module keeps the list one shared constant instead of a
 * per-component copy that could drift.
 */
export const CONTEST_SETTINGS_KEYS: readonly ConfigTomlKey[] = [
  { section: 'contest', key: 'CONTEST_WEB_CPU_LIMIT' },
  { section: 'contest', key: 'CONTEST_WEB_MEMORY_LIMIT' },
  { section: 'contest', key: 'COOKIE_DURATION' },
  { section: 'contest', key: 'ENABLE_TLS' },
  { section: 'contest', key: 'SUBMIT_LOCAL_COPY' },
];
