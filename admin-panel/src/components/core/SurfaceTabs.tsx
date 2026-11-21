'use client';

import { usePathname } from 'next/navigation';

import { Tabs, type TabItem } from '@/components/core/Tabs';
import type { RouteTab } from '@/lib/navigation/types';
import { cn } from '@/lib/utils';

interface SurfaceTabsProps {
  readonly tabs: readonly RouteTab[];
  readonly className?: string;
}

function normalizePath(path: string): string {
  return path === '/' ? path : path.replace(/\/+$/, '');
}

function activeTabId(
  tabs: readonly RouteTab[],
  pathname: string,
): string {
  return tabs.find((tab) => normalizePath(tab.href) === normalizePath(pathname))?.id ?? '';
}

export function SurfaceTabs({ tabs, className }: SurfaceTabsProps): React.JSX.Element | null {
  const pathname = usePathname();
  const items: readonly TabItem[] = tabs.map((tab) => ({
    id: tab.id,
    href: tab.href,
    label: (
      <span className="inline-flex items-center gap-2">
        {tab.icon && <span aria-hidden="true" className="inline-flex">{tab.icon}</span>}
        {tab.label}
      </span>
    ),
  }));

  return (
    <div className={cn('min-w-0 overflow-x-auto', className)}>
      <Tabs
        items={items}
        activeId={activeTabId(tabs, pathname)}
        ariaLabel="Record sections"
        className="min-w-max"
      />
    </div>
  );
}
