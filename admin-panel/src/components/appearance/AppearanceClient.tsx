'use client';

import { Image as ImageIcon, ExternalLink, Settings2 } from 'lucide-react';
import NextImage from 'next/image';
import Link from 'next/link';

export interface BrandingFields {
  rankingLogoPath: string;
}

/** Read-only: the Ranking appearance page owns the editor, and a field that saves nothing is a lie. */
export function BrandingTab({
  logoPreview,
  logoHref,
  branding,
  onFieldChange,
  readOnly = false,
}: {
  logoPreview: string;
  logoHref: string;
  branding?: BrandingFields;
  onFieldChange?: (key: keyof BrandingFields, value: string) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ImageIcon className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Scoreboard Branding Logo</h3>
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
              className="h-auto max-h-28 w-auto max-w-full object-contain"
              unoptimized
            />
          ) : (
            <span className="text-sm text-muted-foreground">
              No logo configured: upload on the Ranking page
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Logo assets are centralized in the database and hot-reloaded across instances.
        </p>
      </div>

      {branding ? (
        <div className="space-y-4 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground">Branding Assets Path</h3>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">RANKING_LOGO_PATH</span>
            <input
              value={branding.rankingLogoPath}
              onChange={(e) => onFieldChange?.('rankingLogoPath', e.target.value)}
              readOnly={readOnly}
              placeholder='e.g. "./config/assets/logo.png"'
              className="h-11 w-full rounded-lg border border-input bg-card/50 px-3 py-2 text-sm text-foreground focus:border-ring/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

const SERVICE_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Ranking', keys: ['RANKING_LISTEN_PORT', 'RANKING_DOMAIN', 'RANKING_LOGO_PATH'] },
  { title: 'Contest', keys: ['CONTEST_ID', 'CONTEST_LISTEN_PORT', 'MAX_SUBMISSION_LENGTH'] },
  { title: 'Worker', keys: ['WORKER_SHARD', 'WORKER_PORT', 'WORKER_REPLICAS'] },
  { title: 'Infrastructure', keys: ['MONITOR_INTERVAL', 'BACKUP_INTERVAL_MINS', 'PROMETHEUS_PORT'] },
];

/** Writing these values recreates services, which is System Settings' job; this page only answers what is configured. */
export function ServicesGroup({ values, missing }: { readonly values: Record<string, string>; readonly missing: string }): React.JSX.Element {
  return (
    <div className="space-y-4">
      {SERVICE_GROUPS.map((group) => (
        <div key={group.title} className="space-y-3">
          <div className="flex items-center gap-2">
            <Settings2 className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">{group.title}</h3>
          </div>
          <div className="grid gap-3">
            {group.keys.map((key) => (
              <div key={key} className="flex items-center justify-between rounded-lg border border-border bg-card/30 px-3 py-2">
                <code className="font-mono text-xs text-foreground">{key}</code>
                <span className="max-w-3/5 truncate text-right text-xs text-muted-foreground">{values[key] ?? missing}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Read-only configuration preview loaded from config.toml.
      </p>
    </div>
  );
}
