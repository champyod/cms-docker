'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { SurfaceHeader } from '@/components/core/SurfaceHeader';
import { SurfaceTabs } from '@/components/core/SurfaceTabs';
import {
  ModuleTabActionScope,
  usePublishedModuleTabActions,
} from '@/components/navigation/ModuleTabActionSlot';
import type { BreadcrumbItem, RouteTab } from '@/lib/navigation/types';
import { cn } from '@/lib/utils';

export type ModuleTabActions = Readonly<Record<string, ReactNode>>;
export type ModuleTabDescriptions = Readonly<Record<string, ReactNode>>;

const NO_DESCRIPTIONS: ModuleTabDescriptions = {};

/**
 * Module surface whose tab selection lives in the URL, so the header action shown
 * beside the title is the one the active tab's panel published, falling back to the
 * static `actionsMap` entry for tabs whose action needs no panel state.
 */
export interface ModuleTabShellProps {
  readonly breadcrumbs: readonly BreadcrumbItem[];
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly descriptions?: ModuleTabDescriptions;
  readonly tabs: readonly RouteTab[];
  readonly actionsMap: ModuleTabActions;
  readonly children: ReactNode;
  readonly className?: string;
}

function normalizePath(path: string): string {
  return path === '/' ? path : path.replace(/\/+$/, '');
}

function activeTabId(tabs: readonly RouteTab[], pathname: string): string {
  return tabs.find((tab) => normalizePath(tab.href) === normalizePath(pathname))?.id ?? '';
}

/**
 * The line the tab the URL opened carries, or `undefined` when that tab has none.
 *
 * Why the path decides it: the title row renders before the tab strip is read back, so the
 * module's own copy cannot know which of its tabs the reader is on.
 */
export function useActiveTabDescription(
  tabs: readonly RouteTab[],
  descriptions: ModuleTabDescriptions,
): ReactNode | undefined {
  const activeId = activeTabId(tabs, usePathname());
  return activeId === '' ? undefined : descriptions[activeId];
}

export function ModuleTabShell(props: ModuleTabShellProps): React.JSX.Element {
  return (
    <ModuleTabActionScope>
      <ModuleTabSurface {...props} />
    </ModuleTabActionScope>
  );
}

/** Why a second component: the reader of published actions has to sit below the scope that
 * owns the store, and a shell that read the store it only just created would find it empty. */
function ModuleTabSurface({
  breadcrumbs,
  title,
  description,
  descriptions,
  tabs,
  actionsMap,
  children,
  className,
}: ModuleTabShellProps): React.JSX.Element {
  const pathname = usePathname();
  const activeId = activeTabId(tabs, pathname);
  const tabDescription = useActiveTabDescription(tabs, descriptions ?? NO_DESCRIPTIONS);
  // Why a published action beats the static one: a panel that owns a live stream, a compose
  // read, or a snapshot holds the only state those controls are true of, so its own element
  // replaces a header built above it. The map stays the source for panels that publish none.
  // Why presence rather than a nullish check: a panel publishing `null` has withdrawn its
  // control for now, and the static entry must not reappear behind it.
  const published = usePublishedModuleTabActions(activeId);
  const activeActions = published.isPublished ? published.actions : actionsMap[activeId];

  return (
    <section
      data-surface="module-tabs"
      className={cn(
        'mx-auto w-full max-w-7xl space-y-6 pb-[env(safe-area-inset-bottom)] md:pb-0',
        className,
      )}
    >
      <SurfaceHeader
        breadcrumbs={breadcrumbs}
        title={title}
        description={tabDescription ?? description}
        actions={activeActions}
      />
      <SurfaceTabs tabs={tabs} />
      <div className="min-w-0">{children}</div>
    </section>
  );
}
