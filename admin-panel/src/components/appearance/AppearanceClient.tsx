'use client';

import { useCallback, useEffect, useState } from 'react';
import { Image as ImageIcon, Save, Settings2 } from 'lucide-react';
import NextImage from 'next/image';

import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import { PageContent, PageHeader } from '@/components/core/Layout';
import { useToast } from '@/components/providers/ToastProvider';
import { readConfigToml, updateConfigToml } from '@/app/actions/appearance';
import { cn } from '@/lib/utils';

type TabKey = 'branding' | 'services';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'branding', label: 'Branding' },
  { key: 'services', label: 'Services' },
];

interface BrandingFields {
  rankingLogoPath: string;
  rankingUsername: string;
  rankingPassword: string;
}

const SERVICE_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Ranking', keys: ['RANKING_LISTEN_PORT', 'RANKING_DOMAIN', 'RANKING_LOGO_PATH'] },
  { title: 'Contest', keys: ['CONTEST_ID', 'CONTEST_LISTEN_PORT', 'MAX_SUBMISSION_LENGTH'] },
  { title: 'Worker', keys: ['WORKER_SHARD', 'WORKER_PORT', 'WORKER_REPLICAS'] },
  { title: 'Infrastructure', keys: ['MONITOR_INTERVAL', 'BACKUP_INTERVAL_MINS', 'PROMETHEUS_PORT'] },
];

function TabBar({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  return (
    <div className="flex gap-2 rounded-xl bg-muted p-1 w-fit">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={cn(
            'rounded-lg px-4 py-1.5 text-sm font-medium transition-colors',
            active === tab.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function BrandingTab({
  branding,
  onFieldChange,
  onSave,
  saving,
  logoPreview,
}: {
  branding: BrandingFields;
  onFieldChange: (key: keyof BrandingFields, value: string) => void;
  onSave: () => void;
  saving: boolean;
  logoPreview: string;
}) {
  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <ImageIcon className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Ranking Logo</h2>
        </div>
        <div className="flex justify-center rounded-xl bg-black/20 p-4">
          {logoPreview ? (
            <NextImage alt="Ranking logo preview" src={logoPreview} width={320} height={112} className="max-h-28 w-auto object-contain" unoptimized />
          ) : (
            <span className="text-sm text-muted-foreground">No logo configured — upload on the Ranking page</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Manage uploads on the Ranking page. This preview is read-only here and busts cache via ?ts.</p>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Branding Fields (read-only preview — save edits to config.toml)</h2>
          <Button size="sm" icon={Save} loading={saving} onClick={onSave}>
            Save to config.toml
          </Button>
        </div>
        <div className="grid gap-4">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">RANKING_LOGO_PATH</span>
            <input
              value={branding.rankingLogoPath}
              onChange={(e) => onFieldChange('rankingLogoPath', e.target.value)}
              placeholder='e.g. "./config/assets/logo.png"'
              className="w-full rounded-lg border border-input bg-card/50 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring/60"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">RANKING_USERNAME</span>
            <input
              value={branding.rankingUsername}
              onChange={(e) => onFieldChange('rankingUsername', e.target.value)}
              className="w-full rounded-lg border border-input bg-card/50 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring/60"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">RANKING_PASSWORD</span>
            <input
              value={branding.rankingPassword}
              onChange={(e) => onFieldChange('rankingPassword', e.target.value)}
              type="password"
              className="w-full rounded-lg border border-input bg-card/50 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring/60"
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

export function AppearanceClient({ locale }: { locale: string }) {
  void locale;
  const { addToast } = useToast();
  const [active, setActive] = useState<TabKey>('branding');
  const [values, setValues] = useState<Record<string, string>>({});
  const [branding, setBranding] = useState<BrandingFields>({ rankingLogoPath: '', rankingUsername: '', rankingPassword: '' });
  const [saving, setSaving] = useState(false);
  const [logoPreview] = useState<string>(`/api/ranking/logo?ts=${Date.now()}`);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const result = await readConfigToml();
      if (cancelled) return;
      if (result.success) {
        setValues(result.values);
        setBranding({
          rankingLogoPath: (result.values['RANKING_LOGO_PATH'] ?? '').replace(/^"|"$/g, ''),
          rankingUsername: (result.values['RANKING_USERNAME'] ?? '').replace(/^"|"$/g, ''),
          rankingPassword: (result.values['RANKING_PASSWORD'] ?? '').replace(/^"|"$/g, ''),
        });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFieldChange = useCallback((key: keyof BrandingFields, value: string) => {
    setBranding((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const updates: Record<string, string> = {};
      if (branding.rankingLogoPath) updates['RANKING_LOGO_PATH'] = `"${branding.rankingLogoPath}"`;
      if (branding.rankingUsername) updates['RANKING_USERNAME'] = `"${branding.rankingUsername}"`;
      if (branding.rankingPassword) updates['RANKING_PASSWORD'] = `"${branding.rankingPassword}"`;
      if (Object.keys(updates).length === 0) {
        addToast({ type: 'warning', title: 'Nothing to save', message: 'No branding fields changed.' });
        return;
      }
      const result = await updateConfigToml(updates);
      if (result.success) {
        addToast({ type: 'success', title: 'Saved', message: 'config.toml updated. Run config sync to apply.' });
      } else {
        addToast({ type: 'error', title: 'Save failed', message: result.error });
      }
    } catch (error) {
      addToast({ type: 'error', title: 'Save failed', message: (error as Error).message });
    } finally {
      setSaving(false);
    }
  }, [addToast, branding]);

  return (
    <PageContent>
      <PageHeader title="Appearance" description="Branding and system service customization from config.toml (read-only preview, save edits where enabled)." />
      <TabBar active={active} onChange={setActive} />
      {active === 'branding' ? (
        <BrandingTab branding={branding} onFieldChange={handleFieldChange} onSave={handleSave} saving={saving} logoPreview={logoPreview} />
      ) : (
        <ServicesTab values={values} />
      )}
    </PageContent>
  );
}
