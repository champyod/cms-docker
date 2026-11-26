'use client';

import { useCallback, useState } from 'react';
import { Image as ImageIcon, Settings2, ExternalLink } from 'lucide-react';
import NextImage from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { DisplayTab } from '@/components/appearance/DisplayTab';
import { Card } from '@/components/core/Card';
import { SurfaceLoadState } from '@/components/core/SurfaceLoadState';
import { Tabs } from '@/components/core/Tabs';
import { readConfigToml } from '@/app/actions/appearance';
import { useDictionary } from '@/hooks/useDictionary';
import { surfaceLoadMessages, useSurfaceLoad } from '@/hooks/useSurfaceLoad';
import { withBasePath } from '@/lib/base-path';
import { localeFromPathname } from '@/lib/navigation/breadcrumbs';
import { buildRoute } from '@/lib/navigation/routes';

type TabKey = 'branding' | 'services' | 'display';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'branding', label: 'Branding' },
  { key: 'services', label: 'Services' },
  { key: 'display', label: 'Display' },
];

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

export interface BrandingFields {
  rankingLogoPath: string;
}

/**
 * The scoreboard's own settings are edited on the Ranking appearance page, which owns every
 * appearance column, so this tab previews the logo and points at the surface that manages it
 * rather than carrying a second editor of the same row.
 */
export function BrandingTab({
  logoPreview,
  logoHref,
  branding,
  onFieldChange,
}: {
  logoPreview: string;
  logoHref: string;
  branding?: BrandingFields;
  onFieldChange?: (key: keyof BrandingFields, value: string) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Ranking Logo Card */}
      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="size-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Scoreboard Branding Logo</h2>
          </div>
          <Link href={logoHref} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            Manage uploads on Ranking page
            <ExternalLink className="size-3" />
          </Link>
        </div>
        <div className="flex justify-center rounded-xl bg-muted/40 p-4">
          {logoPreview ? (
            <NextImage
              alt="Ranking logo preview"
              src={logoPreview}
              width={320}
              height={112}
              className="max-h-28 max-w-full h-auto w-auto object-contain"
              unoptimized
            />
          ) : (
            <span className="text-sm text-muted-foreground">
              No logo configured — upload on the Ranking page
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Logo assets are centralized in the database and hot-reloaded across instances.
        </p>
      </Card>

      {/* Branding Fields (read-only configuration view) */}
      {branding ? (
        <Card className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Branding Assets Path</h2>
          <div className="grid gap-4">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">RANKING_LOGO_PATH</span>
              <input
                value={branding.rankingLogoPath}
                onChange={(e) => onFieldChange?.('rankingLogoPath', e.target.value)}
                placeholder='e.g. "./config/assets/logo.png"'
                className="h-11 w-full rounded-lg border border-input bg-card/50 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>
          </div>
        </Card>
      ) : null}
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
          <p className="text-xs text-muted-foreground">
            Read-only configuration preview loaded from config.toml.
          </p>
        </Card>
      ))}
    </div>
  );
}

export function AppearanceClient(): React.JSX.Element {
  const dict = useDictionary();
  const locale = localeFromPathname(usePathname());
  const [active, setActive] = useState<TabKey>('branding');
  const [values, setValues] = useState<Record<string, string>>({});
  const [logoPreview] = useState<string>(() => `/api/ranking/logo?ts=${Date.now()}`);

  const load = useCallback(async (): Promise<void> => {
    const tomlResult = await readConfigToml();

    if (!tomlResult.success) throw new Error(tomlResult.error);
    setValues(tomlResult.values);
  }, []);

  const { status, reload } = useSurfaceLoad(load, surfaceLoadMessages(dict));

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
        <BrandingTab logoPreview={withBasePath(logoPreview)} logoHref={buildRoute(locale, 'ranking.board')} />
      ) : active === 'services' ? (
        <ServicesTab values={values} />
      ) : (
        <DisplayTab />
      )}
    </div>
  );
}
