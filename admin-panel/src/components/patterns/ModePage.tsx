import type { ReactNode } from 'react';

import { PageSurface } from '@/components/core/PageSurface';
import { Tabs } from '@/components/core/Tabs';
import type { PageSlots } from '@/components/patterns/page-types';

export interface ModeLink {
  readonly key: string;
  /** Where this mode lives. Modes are addresses, so a half-finished flow is shareable and reloadable. */
  readonly href: string;
  readonly label: string;
}

export interface UnavailableMode {
  readonly label: string;
  /** Why this mode cannot be opened by this account. A mode that vanishes reads as a bug. */
  readonly reason: string;
}

export interface ModePageProps extends Omit<PageSlots, 'children'> {
  /** The modes this account can open, in the order they are read. */
  readonly modes: readonly ModeLink[];
  readonly activeKey: string;
  /** Modes this account cannot open, named with the permission they need. */
  readonly unavailable?: readonly UnavailableMode[];
  /** What the switcher chooses between, for a reader who cannot see the page title above it. */
  readonly modesLabel?: string;
  readonly state?: ReactNode;
  readonly freshness?: ReactNode;
  readonly children: ReactNode;
  readonly ownsHeader?: boolean;
}

/** Mutually exclusive workflows; the switcher is links, so a mode is an address that survives a reload. */
export function ModePage({
  breadcrumbs,
  title,
  description,
  actions,
  modes,
  activeKey,
  unavailable,
  modesLabel,
  state,
  freshness,
  children,
  ownsHeader = true,
}: ModePageProps): React.JSX.Element {
  // A key the list does not contain highlights nothing, which reads as a broken switcher.
  if (process.env.NODE_ENV !== 'production' && modes.length > 0 && !modes.some((mode) => mode.key === activeKey)) {
    throw new Error(`ModePage: activeKey "${activeKey}" is not one of the modes this page lists`);
  }

  return (
    <PageSurface breadcrumbs={breadcrumbs} title={title} description={description} actions={actions} ownsHeader={ownsHeader}>
      <div className="space-y-4">
        {state}
        {freshness && <p className="text-xs text-muted-foreground">{freshness}</p>}
        <Tabs
          items={modes.map((mode) => ({ id: mode.key, label: mode.label, href: mode.href }))}
          activeId={activeKey}
          ariaLabel={title ? String(title) : (modesLabel ?? 'Modes')}
        />
        {unavailable && unavailable.length > 0 && (
          <p className="text-muted-foreground">
            {unavailable.map((mode) => `${mode.label} - ${mode.reason}`).join(', ')}
          </p>
        )}
        {children}
      </div>
    </PageSurface>
  );
}
