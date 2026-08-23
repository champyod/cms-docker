export interface EnvConfigField {
  key: string;
  label: string;
  description?: string;
  placeholder?: string;
}

export interface EnvConfigSection {
  title: string;
  filename: string;
  fields: EnvConfigField[];
}

export type EnvFilesData = Record<string, Record<string, string>>;

export const CONFIG_SECTIONS: EnvConfigSection[] = [
  {
    title: 'Database Configuration',
    filename: '.env.core',
    fields: [
      { key: 'POSTGRES_DB', label: 'Database Name', description: 'PostgreSQL database name.' },
      { key: 'POSTGRES_USER', label: 'Database User', description: 'PostgreSQL username.' },
      { key: 'POSTGRES_PASSWORD', label: 'Database Password', description: 'PostgreSQL password.' },
    ]
  },
  {
    title: 'Network & Access',
    filename: '.env.core',
    fields: [
      { key: 'PUBLIC_IP', label: 'Public IP', description: 'Public facing IP address of this server.' },
      { key: 'TAILSCALE_IP', label: 'Tailscale IP', description: 'Internal VPN IP (optional).' },
      { key: 'APT_MIRROR', label: 'Ubuntu Mirror', description: 'Mirror for apt updates.' },
    ]
  },
  {
    title: 'Admin Panel Config',
    filename: '.env.admin',
    fields: [
      { key: 'VITE_API_URL', label: 'API URL', description: 'URL for the Admin API.' },
      { key: 'ADMIN_LISTEN_PORT', label: 'Admin Port', description: 'Internal port for Admin Web Server.' },
    ]
  },
  {
    title: 'Ranking Settings',
    filename: '.env.admin',
    fields: [
      { key: 'RANKING_USERNAME', label: 'Ranking Username', description: 'Auth for scoreboard.' },
      { key: 'RANKING_PASSWORD', label: 'Ranking Password', description: 'Auth for scoreboard.' },
      { key: 'ADMIN_COOKIE_DURATION', label: 'Admin Session', description: 'Admin panel session length.' },
    ]
  }
];

export function deepCopyEnvData(data: EnvFilesData): EnvFilesData {
  return JSON.parse(JSON.stringify(data));
}

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

export function collectRelevantUpdates(filename: string, data: EnvFilesData): Record<string, string> {
  const relevantUpdates: Record<string, string> = {};
  const sections = CONFIG_SECTIONS.filter(s => s.filename === filename);

  sections.forEach(section => {
    section.fields.forEach(f => {
      const value = data[filename]?.[f.key];
      if (value !== undefined) {
        relevantUpdates[f.key] = value;
      }
    });
  });

  return relevantUpdates;
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
