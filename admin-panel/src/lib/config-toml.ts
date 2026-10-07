import { readTomlValue, upsertTomlValue } from '@/lib/discord-webhook';

// config.toml is the single source of truth for configuration: scripts/__config_sync.sh
// truncates and re-emits .env from it (update-server runs that on every deploy), so any
// key a panel writes into a generated file is erased at the next sync. Every panel write
// therefore goes through the section-scoped TOML upsert that the active-contest module
// established, and the section list is closed: upsertTomlValue appends a missing section,
// so an unknown name would create one the generator never parses.
export const CONFIG_TOML_FILE = 'config.toml';

export const CONFIG_TOML_SECTIONS = [
  'core',
  'admin',
  'contest',
  'worker',
  'infra',
  'tailscale',
  'rpc',
] as const;

export type ConfigTomlSection = (typeof CONFIG_TOML_SECTIONS)[number];

export interface ConfigTomlKey {
  section: ConfigTomlSection;
  key: string;
}

export interface ConfigTomlUpdate extends ConfigTomlKey {
  value: string;
}

const CONFIG_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isConfigTomlSection(value: string): value is ConfigTomlSection {
  return (CONFIG_TOML_SECTIONS as readonly string[]).includes(value);
}

export function isValidConfigKey(value: string): boolean {
  return CONFIG_KEY_RE.test(value);
}

// A TOML basic string cannot span lines, and the sync's parser reads one line per key.
function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

/** Returns content with every update applied inside its own section, others untouched. */
export function applyConfigTomlUpdates(
  content: string,
  updates: readonly ConfigTomlUpdate[],
): string {
  return updates.reduce(
    (accumulated, { section, key, value }) =>
      upsertTomlValue(accumulated, section, key, singleLine(value)),
    content,
  );
}

/** Reads the requested keys, keyed by key name; a key absent from its section yields ''. */
export function extractConfigTomlValues(
  content: string,
  keys: readonly ConfigTomlKey[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const { section, key } of keys) {
    values[key] = readTomlValue(content, section, key);
  }
  return values;
}

/** Pairs the values a screen actually holds with the section and key that own them. */
export function buildConfigTomlUpdates(
  data: Readonly<Record<string, string>>,
  keys: readonly ConfigTomlKey[],
): ConfigTomlUpdate[] {
  return keys.flatMap(({ section, key }) => {
    const value = data[key];
    return value === undefined ? [] : [{ section, key, value }];
  });
}
