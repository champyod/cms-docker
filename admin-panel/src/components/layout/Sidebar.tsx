'use client';

import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, LogOut } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { DASHBOARD_ITEM, DOCUMENTATION_ITEM, CONTEST_ITEMS, INFRASTRUCTURE_ITEMS, buildVisibility, type SidebarPermissions } from '@/components/layout/sidebar-nav';
import { SidebarNavItem, SectionLabel } from '@/components/layout/SidebarNavItem';

export const SIDEBAR_STORAGE_KEY = 'cms-sidebar-expanded';
const SIDEBAR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function persistExpandedPreference(expanded: boolean): void {
  const value = expanded ? '1' : '0';
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, value);
  } catch {
    // storage blocked; cookie remains
  }
  document.cookie = `${SIDEBAR_STORAGE_KEY}=${value}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

function SignOutLink({ locale, collapsed }: { locale: string; collapsed: boolean }): React.JSX.Element {
  const anchor = (
    <a href={`/${locale}/auth/signout`} className={cn('flex h-9 items-center rounded-lg px-2.5 text-sm font-medium outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50', collapsed && 'w-9 justify-center px-0')}>
      <LogOut className="size-4 shrink-0" aria-hidden />
      {!collapsed && <span className="ml-3 truncate">Sign Out</span>}
    </a>
  );
  if (!collapsed) return anchor;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{anchor}</TooltipTrigger>
      <TooltipContent side="right">Sign Out</TooltipContent>
    </Tooltip>
  );
}

export interface SidebarProps {
  className?: string;
  locale: string;
  permissions?: SidebarPermissions;
  initialExpanded?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ className, locale, permissions, initialExpanded = true }) => {
  const [expanded, setExpanded] = useState(initialExpanded);
  const visibility = buildVisibility(permissions);

  const handleToggle = (): void => {
    const next = !expanded;
    setExpanded(next);
    persistExpandedPreference(next);
  };

  return (
    <aside className={cn('sticky top-0 relative flex h-screen shrink-0 flex-col border-r border-border bg-background/95 backdrop-blur transition-[width] duration-200', expanded ? 'w-56' : 'w-14', className)}>
      <div className="absolute top-20 -right-3 z-10">
        <Button variant="secondary" size="sm" iconOnly tooltip={expanded ? 'Collapse sidebar' : 'Expand sidebar'} onClick={handleToggle} className="rounded-full border border-border shadow-md">
          {expanded ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
        </Button>
      </div>
      <div className={cn('flex h-16 shrink-0 items-center border-b border-border px-3', expanded ? 'gap-3' : 'justify-center px-0')}>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground shadow-sm">C</div>
        {expanded && <span className="truncate font-semibold">CMS Admin</span>}
      </div>
      <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto px-2 py-3 scrollbar-thin scrollbar-thumb-border hover:scrollbar-thumb-muted-foreground/40">
        <SidebarNavItem item={DASHBOARD_ITEM} locale={locale} collapsed={!expanded} />
        <SectionLabel label="Contest" collapsed={!expanded} />
        {CONTEST_ITEMS.filter((item) => item.isVisible(visibility)).map((item) => (
          <SidebarNavItem key={item.label} item={item} locale={locale} collapsed={!expanded} />
        ))}
        {visibility.superadmin && (
          <>
            <SectionLabel label="Infrastructure" collapsed={!expanded} />
            {INFRASTRUCTURE_ITEMS.map((item) => (
              <SidebarNavItem key={item.label} item={item} locale={locale} collapsed={!expanded} />
            ))}
          </>
        )}
      </nav>
      <div className="shrink-0 space-y-1 border-t border-border px-2 py-3">
        <SidebarNavItem item={DOCUMENTATION_ITEM} locale={locale} collapsed={!expanded} />
        <SignOutLink locale={locale} collapsed={!expanded} />
      </div>
    </aside>
  );
};
