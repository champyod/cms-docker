'use client';

import { useCallback, useState } from 'react';
import { Image as ImageIcon, Save, Settings2 } from 'lucide-react';
import NextImage from 'next/image';

import { DisplayTab } from '@/components/appearance/DisplayTab';
import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import { SurfaceLoadState } from '@/components/core/SurfaceLoadState';
import { Tabs } from '@/components/core/Tabs';
import { toast } from 'sonner';
import { readConfigToml, updateConfigToml } from '@/app/actions/appearance';
import { useDictionary } from '@/hooks/useDictionary';
import { surfaceLoadMessages, useSurfaceLoad } from '@/hooks/useSurfaceLoad';
import { usePublishModuleActions } from '@/components/navigation/ModuleActionSlot';

type TabKey = 'branding' | 'services' | 'display';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'branding', label: 'Branding' },
  { key: 'services', label: 'Services' },
  { key: 'display', label: 'Display' },
];

interface BrandingFields {
  rankingLogoPath: string;
}

const SERVICE_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Ranking', keys: ['RANKING_LISTEN_PORT', 'RANKING_DOMAIN', 'RANKING_LOGO_PATH'] },
  { title: 'Contest', keys: ['CONTEST_ID', 'CONTEST_LISTEN_PORT', 'MAX_SUBMISSION_LENGTH'] },
  { title: 'Worker', keys: ['WORKER_SHARD', 'WORKER_PORT', 'WORKER_REPLICAS'] },
  { title: 'Infrastructure', keys: ['MONITOR_INTERVAL', 'BACKUP_INTERVAL_MINS', 'PROMETHEUS_PORT'] },
];

function AppearanceTabs({ active, onChange }: { active: TabKey; onChange: (key: TabKey) => void }) {
  return (
    <Tabs
      items={TABS.map((tab) => ({ id: tab.key, label: tab.label }))}
      activeId={active}
      ariaLabel="Appearance sections"
      onSelect={(id) => onChange(id as TabKey)}
    />
  );
}

export function BrandingTab({
  branding,
  onFieldChange,
  logoPreview,
}: {
  branding: BrandingFields;
  onFieldChange: (key: keyof BrandingFields, value: string) => void;
  logoPreview: string;
}) {
  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <ImageIcon className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Ranking Logo</h2>
        </div>
        <div className="flex justify-center rounded-xl bg-muted/40 p-4">
          {logoPreview ? (
            <NextImage alt="Ranking logo preview" src={logoPreview} width={320} height={112} className="max-h-28 max-w-full h-auto w-auto object-contain" unoptimized />
          ) : (
            <span className="text-sm text-muted-foreground">No logo configured — upload on the Ranking page</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Manage uploads on the Ranking page. This preview is read-only here and busts cache via ?ts.</p>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Branding Fields (read-only preview — save edits to config.toml)</h2>
        <div className="grid gap-4">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">RANKING_LOGO_PATH</span>
            <input
              value={branding.rankingLogoPath}
              onChange={(e) => onFieldChange('rankingLogoPath', e.target.value)}
              placeholder='e.g. "./config/assets/logo.png"'
              className="h-11 w-full rounded-lg border border-input bg-card/50 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </label>
        </div>
      </Card>
    </div>
  );
}

function ServicesTab({ values }: { values: Record<string, string> }) {
  return (
    <div className="space-y-6">
      {SERVICE_GROUPS.map((group) => (
        <Card key={group.title} className="space-y-3">
          <div className="flex items-center gap-2">
            <Settings2 className="size-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">{group.title}</h2>
          </div>
          <div className="grid gap-3">
            {group.keys.map((key) => (
              <div key={key} className="flex items-center justify-between rounded-lg border border-border bg-card/30 px-3 py-2">
                <code className="text-xs font-mono text-primary">{key}</code>
                <span className="max-w-3/5 truncate text-xs text-muted-foreground text-right">{values[key] ?? '—'}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Read-only preview. Edit config.toml directly or extend save to these keys.</p>
        </Card>
      ))}
    </div>
  );
}

export function AppearanceClient(): React.JSX.Element {
  const dict = useDictionary();
  const [active, setActive] = useState<TabKey>('branding');
  const [values, setValues] = useState<Record<string, string>>({});
  const [branding, setBranding] = useState<BrandingFields>({ rankingLogoPath: '' });
  const [saving, setSaving] = useState(false);
  const [logoPreview] = useState<string>(() => `/api/ranking/logo?ts=${Date.now()}`);

  // Why the read no longer decides whether to render: `if (result.success)` left a refused or
  // failed read looking like an empty config, with no error and no way back. The load ends in
  // data, denied or failed, and the surface below renders that.
  const load = useCallback(async (): Promise<void> => {
    const result = await readConfigToml();
    if (!result.success) throw new Error(result.error);
    setValues(result.values);
    setBranding({
      rankingLogoPath: (result.values['RANKING_LOGO_PATH'] ?? '').replace(/^"|"$/g, ''),
    });
  }, []);

  const { status, reload } = useSurfaceLoad(load, surfaceLoadMessages(dict));

  const handleFieldChange = useCallback((key: keyof BrandingFields, value: string) => {
    setBranding((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const updates: Record<string, string> = {};
      updates['RANKING_LOGO_PATH'] = `"${branding.rankingLogoPath}"`;
      const result = await updateConfigToml(updates);
      if (result.success) {
        toast.success('Saved', { description: 'config.toml updated. Run config sync to apply.' });
      } else {
        toast.error('Save failed', { description: result.error });
      }
    } catch (error) {
      toast.error('Save failed', { description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  }, [branding]);

  // Why published only over Branding and once loaded: the fields this Save writes belong to
  // the Branding panel, so the same control shown over Services or Display would offer to save
  // edits the reader cannot see on screen, and before the read there is nothing to save.
  usePublishModuleActions(
    'system.appearance',
    active === 'branding' && status.kind === 'idle' ? (
      <Button size="sm" icon={Save} loading={saving} onClick={() => void handleSave()}>
        Save to config.toml
      </Button>
    ) : null,
  );

  if (status.kind !== 'idle') {
    return (
      <SurfaceLoadState
        status={status}
        loadingTitle={dict['navigation']['system']['appearance']['label']}
        onRetry={reload}
        retryLabel={dict.states.retry.label}
      />
    );
  }

  return (
    <div className="space-y-6">
      <AppearanceTabs active={active} onChange={setActive} />
      {active === 'branding' ? (
        <BrandingTab branding={branding} onFieldChange={handleFieldChange} logoPreview={logoPreview} />
      ) : active === 'services' ? (
        <ServicesTab values={values} />
      ) : (
        <DisplayTab />
      )}
    </div>
  );
}
