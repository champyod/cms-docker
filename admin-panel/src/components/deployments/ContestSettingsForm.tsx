'use client';

import { Text } from '@/components/core/Typography';
import { Stack } from '@/components/core/Layout';

interface ContestSettingsFormProps {
  globalSettings: Record<string, string>;
  onGlobalChange: (key: string, val: string) => void;
}

/**
 * The config.toml values the contest stack reads on its next start.
 *
 * WHY no title and no save button: the board names this section, and the save is the section's action
 * — it belongs in the section header, where it is reachable before the reader scrolls the fields.
 * WHY no card: the board already frames the section.
 */
export function ContestSettingsForm({ globalSettings, onGlobalChange }: ContestSettingsFormProps) {
  return (
    <Stack gap={6}>
      <div className="grid grid-cols-2 gap-4">
        <Stack gap={1}>
          <Text variant="label">CPU Limit</Text>
          <input
            type="text"
            value={globalSettings.CONTEST_WEB_CPU_LIMIT || ''}
            onChange={(e) => onGlobalChange('CONTEST_WEB_CPU_LIMIT', e.target.value)}
            className="w-full rounded-lg border border-input bg-card/50 px-4 py-2 text-sm text-foreground outline-none focus:border-ring/60"
            placeholder="e.g. 2"
          />
        </Stack>
        <Stack gap={1}>
          <Text variant="label">Mem Limit</Text>
          <input
            type="text"
            value={globalSettings.CONTEST_WEB_MEMORY_LIMIT || ''}
            onChange={(e) => onGlobalChange('CONTEST_WEB_MEMORY_LIMIT', e.target.value)}
            className="w-full rounded-lg border border-input bg-card/50 px-4 py-2 text-sm text-foreground outline-none focus:border-ring/60"
            placeholder="e.g. 2G"
          />
        </Stack>
      </div>

      <Stack gap={1}>
        <Text variant="label">Cookie Duration (s)</Text>
        <input
          type="number"
          value={globalSettings.COOKIE_DURATION || ''}
          onChange={(e) => onGlobalChange('COOKIE_DURATION', e.target.value)}
          className="w-full rounded-lg border border-input bg-card/50 px-4 py-2 text-sm text-foreground outline-none focus:border-ring/60"
          placeholder="10800"
        />
      </Stack>

      <Stack gap={4} className="border-t border-border pt-4">
        <Stack direction="row" align="center" gap={2}>
          <input
            type="checkbox"
            id="tls"
            checked={globalSettings.ENABLE_TLS === 'true'}
            onChange={(e) => onGlobalChange('ENABLE_TLS', e.target.checked ? 'true' : 'false')}
            className="rounded border-input bg-card accent-primary"
          />
          <label htmlFor="tls" className="text-xs text-muted-foreground">Enable HTTPS (Traefik)</label>
        </Stack>
        <Stack direction="row" align="center" gap={2}>
          <input
            type="checkbox"
            id="localCopy"
            checked={globalSettings.SUBMIT_LOCAL_COPY === 'true'}
            onChange={(e) => onGlobalChange('SUBMIT_LOCAL_COPY', e.target.checked ? 'true' : 'false')}
            className="rounded border-input bg-card accent-primary"
          />
          <label htmlFor="localCopy" className="text-xs text-muted-foreground">Store Local Copy of Submissions</label>
        </Stack>
      </Stack>
    </Stack>
  );
}
