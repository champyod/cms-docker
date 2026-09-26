import {
  CONFIG_TOML_FILE,
  buildConfigTomlUpdates,
  type ConfigTomlKey,
  type ConfigTomlSection,
  type ConfigTomlUpdate,
} from '@/lib/config-toml';

export interface EnvConfigField {
  key: string;
  /** Where in config.toml this key lives — the panel writes it there, never into .env. */
  tomlSection: ConfigTomlSection;
  label: string;
  description?: string;
  placeholder?: string;
}

export interface EnvConfigSection {
  title: string;
  /** The file these fields are stored in; the section they belong to is per field. */
  filename: string;
  fields: EnvConfigField[];
}

export type EnvFilesData = Record<string, Record<string, string>>;

export const CONFIG_SECTIONS: EnvConfigSection[] = [
  {
    title: 'Database Configuration',
    filename: CONFIG_TOML_FILE,
    fields: [
      { key: 'POSTGRES_DB', tomlSection: 'core', label: 'Database Name', description: 'PostgreSQL database name.' },
      { key: 'POSTGRES_USER', tomlSection: 'core', label: 'Database User', description: 'PostgreSQL username.' },
      { key: 'POSTGRES_PASSWORD', tomlSection: 'core', label: 'Database Password', description: 'PostgreSQL password.' },
    ]
  },
  {
    title: 'Network & Access',
    filename: CONFIG_TOML_FILE,
    fields: [
      { key: 'PUBLIC_IP', tomlSection: 'core', label: 'Public IP', description: 'Public facing IP address of this server.' },
      { key: 'TAILSCALE_IP', tomlSection: 'core', label: 'Tailscale IP', description: 'Internal VPN IP (optional).' },
      { key: 'APT_MIRROR', tomlSection: 'core', label: 'Ubuntu Mirror', description: 'Mirror for apt updates.' },
    ]
  },
  {
    title: 'Admin Panel Config',
    filename: CONFIG_TOML_FILE,
    fields: [
      { key: 'VITE_API_URL', tomlSection: 'admin', label: 'API URL', description: 'URL for the Admin API.' },
      { key: 'ADMIN_LISTEN_PORT', tomlSection: 'admin', label: 'Admin Port', description: 'Internal port for Admin Web Server.' },
    ]
  },
  {
    title: 'Ranking Settings',
    filename: CONFIG_TOML_FILE,
    fields: [
      { key: 'RANKING_USERNAME', tomlSection: 'admin', label: 'Ranking Username', description: 'Auth for scoreboard.' },
      { key: 'RANKING_PASSWORD', tomlSection: 'admin', label: 'Ranking Password', description: 'Auth for scoreboard.' },
      { key: 'ADMIN_COOKIE_DURATION', tomlSection: 'admin', label: 'Admin Session', description: 'Admin panel session length.' },
    ]
  }
];

export function updateFileValue(
  prev: EnvFilesData,
  filename: string,
  key: string,
  value: string,
): EnvFilesData {
  return {
    ...prev,
    [filename]: {
      ...prev[filename],
      [key]: value
    }
  };
}

/** Every field the settings screen edits, for the config.toml read. */
export function configTomlKeys(): ConfigTomlKey[] {
  return CONFIG_SECTIONS.flatMap(section =>
    section.fields.map(field => ({ section: field.tomlSection, key: field.key })),
  );
}

/** The edited values of one section, paired with the config.toml section that owns them. */
export function collectRelevantUpdates(filename: string, data: EnvFilesData): ConfigTomlUpdate[] {
  return CONFIG_SECTIONS.filter(s => s.filename === filename).flatMap(section =>
    buildConfigTomlUpdates(
      data[filename] ?? {},
      section.fields.map(field => ({ section: field.tomlSection, key: field.key })),
    ),
  );
}

export function computeChangedKeys(data: EnvFilesData, originalData: EnvFilesData): string[] {
  const changedKeys: string[] = [];

  Object.keys(data).forEach(filename => {
    const currentFile = data[filename] || {};
    const originalFile = originalData[filename] || {};

    CONFIG_SECTIONS.filter(s => s.filename === filename).forEach(section => {
      section.fields.forEach(field => {
        if (currentFile[field.key] !== originalFile[field.key]) {
          changedKeys.push(field.key);
        }
      });
    });
  });

  return changedKeys;
}
