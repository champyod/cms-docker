'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { SurfaceHeader } from '@/components/core/SurfaceHeader';
import {
  ModuleActionScope,
  usePublishedModuleActions,
} from '@/components/navigation/ModuleActionSlot';
import type { ModuleFieldItem } from '@/lib/navigation/module-nav';
import type { BreadcrumbItem } from '@/lib/navigation/types';
import { cn } from '@/lib/utils';

export type ModuleActions = Readonly<Record<string, ReactNode>>;
export type ModuleDescriptions = Readonly<Record<string, ReactNode>>;

export interface ModuleShellProps {
  readonly breadcrumbs: readonly BreadcrumbItem[];
  readonly fields: readonly ModuleFieldItem[];
  readonly descriptions: ModuleDescriptions;
  readonly actionsMap: ModuleActions;
  readonly fallbackTitle: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

function normalizePath(path: string): string {
  return path === '/' ? path : path.replace(/\/+$/, '');
}

/** The field the URL opened, or null where no field claims the path. */
function activeField(
  fields: readonly ModuleFieldItem[],
  pathname: string,
): ModuleFieldItem | null {
  return fields.find((field) => normalizePath(field.href) === normalizePath(pathname)) ?? null;
}

export function ModuleShell(props: ModuleShellProps): React.JSX.Element {
  return (
    <ModuleActionScope>
      <ModuleSurface {...props} />
    </ModuleActionScope>
  );
}

// The action reader must sit below the scope that owns the store, or it would read empty.
function ModuleSurface({
  breadcrumbs,
  fields,
  descriptions,
  actionsMap,
  fallbackTitle,
  children,
  className,
}: ModuleShellProps): React.JSX.Element {
  const pathname = usePathname();
  const field = activeField(fields, pathname);
  const fieldId = field?.id ?? '';
  const published = usePublishedModuleActions(fieldId);
  const actions = published.isPublished ? published.actions : actionsMap[fieldId];

  return (
    <section
      data-surface="module"
      className={cn(
        'mx-auto w-full max-w-7xl space-y-6 pb-[env(safe-area-inset-bottom)] md:pb-0',
        className,
      )}
    >
      <SurfaceHeader
        breadcrumbs={breadcrumbs}
        title={field?.label ?? fallbackTitle}
        description={descriptions[fieldId]}
        actions={actions}
      />
      <div className="min-w-0">{children}</div>
    </section>
  );
}
