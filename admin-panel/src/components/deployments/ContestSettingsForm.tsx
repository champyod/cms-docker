'use client';

import { Card } from '@/components/core/Card';
import { Text } from '@/components/core/Typography';
import { Stack } from '@/components/core/Layout';
import { Button } from '@/components/core/Button';
import { Save } from 'lucide-react';

interface ContestSettingsFormProps {
  globalSettings: Record<string, string>;
  saving: boolean;
  isDirty: boolean;
  onGlobalChange: (key: string, val: string) => void;
  onSaveSettings: () => void;
}

export function ContestSettingsForm({ globalSettings, saving, isDirty, onGlobalChange, onSaveSettings }: ContestSettingsFormProps) {
    return (
        <Stack gap={4}>
            <Stack direction="row" align="center" gap={2} className="px-2">
                <Text variant="h2">Contest Settings</Text>
                {isDirty && (
                    <Button
                        onClick={onSaveSettings}
                        disabled={saving}
                        size="sm"
                        className="ml-auto"
                    >
                        <Save className="w-3 h-3 mr-1.5" />
                        Save Settings
                    </Button>
                )}
            </Stack>

            <Card className="p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                    <Stack gap={1}>
                        <Text variant="label">CPU Limit</Text>
                        <input
                            type="text"
                            value={globalSettings.CONTEST_WEB_CPU_LIMIT || ''}
                            onChange={(e) => onGlobalChange('CONTEST_WEB_CPU_LIMIT', e.target.value)}
                            className="w-full bg-card/50 px-4 py-2 rounded-lg border border-input text-foreground outline-none focus:border-ring/60 text-sm"
                            placeholder="e.g. 2"
                        />
                    </Stack>
                    <Stack gap={1}>
                        <Text variant="label">Mem Limit</Text>
                        <input
                            type="text"
                            value={globalSettings.CONTEST_WEB_MEMORY_LIMIT || ''}
                            onChange={(e) => onGlobalChange('CONTEST_WEB_MEMORY_LIMIT', e.target.value)}
                            className="w-full bg-card/50 px-4 py-2 rounded-lg border border-input text-foreground outline-none focus:border-ring/60 text-sm"
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
                        className="w-full bg-card/50 px-4 py-2 rounded-lg border border-input text-foreground outline-none focus:border-ring/60 text-sm"
                        placeholder="10800"
                    />
                </Stack>

                <Stack gap={4} className="pt-4 border-t border-border">
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
            </Card>
        </Stack>
    );
}
