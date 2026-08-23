'use client';

import { Card } from '@/components/core/Card';
import { Text } from '@/components/core/Typography';
import { Stack } from '@/components/core/Layout';
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
                    <button
                        onClick={onSaveSettings}
                        disabled={saving}
                        className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs transition-colors disabled:opacity-50"
                    >
                        <Save className="w-3 h-3" />
                        Save Settings
                    </button>
                )}
            </Stack>

            <Card className="glass-card border-white/5 p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                    <Stack gap={1}>
                        <Text variant="label">CPU Limit</Text>
                        <input
                            type="text"
                            value={globalSettings.CONTEST_WEB_CPU_LIMIT || ''}
                            onChange={(e) => onGlobalChange('CONTEST_WEB_CPU_LIMIT', e.target.value)}
                            className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-indigo-500/50 text-sm"
                            placeholder="e.g. 2"
                        />
                    </Stack>
                    <Stack gap={1}>
                        <Text variant="label">Mem Limit</Text>
                        <input
                            type="text"
                            value={globalSettings.CONTEST_WEB_MEMORY_LIMIT || ''}
                            onChange={(e) => onGlobalChange('CONTEST_WEB_MEMORY_LIMIT', e.target.value)}
                            className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-indigo-500/50 text-sm"
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
                        className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-indigo-500/50 text-sm"
                        placeholder="10800"
                    />
                </Stack>

                <Stack gap={4} className="pt-4 border-t border-white/5">
                    <Stack direction="row" align="center" gap={2}>
                        <input
                            type="checkbox"
                            id="tls"
                            checked={globalSettings.ENABLE_TLS === 'true'}
                            onChange={(e) => onGlobalChange('ENABLE_TLS', e.target.checked ? 'true' : 'false')}
                            className="rounded border-white/10 bg-black/40 text-indigo-600 focus:ring-indigo-500"
                        />
                        <label htmlFor="tls" className="text-xs text-neutral-300">Enable HTTPS (Traefik)</label>
                    </Stack>
                    <Stack direction="row" align="center" gap={2}>
                        <input
                            type="checkbox"
                            id="localCopy"
                            checked={globalSettings.SUBMIT_LOCAL_COPY === 'true'}
                            onChange={(e) => onGlobalChange('SUBMIT_LOCAL_COPY', e.target.checked ? 'true' : 'false')}
                            className="rounded border-white/10 bg-black/40 text-indigo-600 focus:ring-indigo-500"
                        />
                        <label htmlFor="localCopy" className="text-xs text-neutral-300">Store Local Copy of Submissions</label>
                    </Stack>
                </Stack>
            </Card>
        </Stack>
    );
}
