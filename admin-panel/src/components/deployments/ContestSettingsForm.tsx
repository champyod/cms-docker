'use client';

import { Checkbox } from '@/components/core/Checkbox';
import { Input } from '@/components/core/Input';
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
export function ContestSettingsForm({ globalSettings, onGlobalChange }: ContestSettingsFormProps): React.JSX.Element {
  return (
    <Stack gap={6}>
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="CPU Limit"
          type="text"
          value={globalSettings.CONTEST_WEB_CPU_LIMIT || ''}
          onChange={(e) => onGlobalChange('CONTEST_WEB_CPU_LIMIT', e.target.value)}
          placeholder="e.g. 2"
        />
        <Input
          label="Mem Limit"
          type="text"
          value={globalSettings.CONTEST_WEB_MEMORY_LIMIT || ''}
          onChange={(e) => onGlobalChange('CONTEST_WEB_MEMORY_LIMIT', e.target.value)}
          placeholder="e.g. 2G"
        />
      </div>

      <Input
        label="Cookie Duration (s)"
        type="number"
        value={globalSettings.COOKIE_DURATION || ''}
        onChange={(e) => onGlobalChange('COOKIE_DURATION', e.target.value)}
        placeholder="10800"
      />

      <Stack gap={4} className="border-t border-border pt-4">
        <Checkbox
          id="tls"
          label="Enable HTTPS (Traefik)"
          checked={globalSettings.ENABLE_TLS === 'true'}
          onChange={(e) => onGlobalChange('ENABLE_TLS', e.target.checked ? 'true' : 'false')}
        />
        <Checkbox
          id="localCopy"
          label="Store Local Copy of Submissions"
          checked={globalSettings.SUBMIT_LOCAL_COPY === 'true'}
          onChange={(e) => onGlobalChange('SUBMIT_LOCAL_COPY', e.target.checked ? 'true' : 'false')}
        />
      </Stack>
    </Stack>
  );
}
