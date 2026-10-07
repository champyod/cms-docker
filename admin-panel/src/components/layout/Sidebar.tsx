'use client';

import React, { Fragment, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, LogOut } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/core/Tooltip';
import { cn } from '@/lib/utils';
import { useDictionary } from '@/hooks/useDictionary';
import {
  buildShellSections,
  type ShellNavItem,
  type ShellNavSection,
} from '@/components/navigation/shell-nav';
import { SectionLabel, SidebarNavItem } from '@/components/layout/SidebarNavItem';

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

function ExpandedBrandRow({ onToggle }: { onToggle: () => void }): React.JSX.Element {
  return (
    <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground shadow-sm">C</div>
        <span className="truncate font-display font-semibold tracking-wide">CMS Admin</span>
      </div>
      <Button variant="secondary" size="sm" iconOnly tooltip="Collapse sidebar" onClick={onToggle}>
        <ChevronLeft className="size-4" />
      </Button>
    </div>
  );
}

function CollapsedBrandRow({ onToggle }: { onToggle: () => void }): React.JSX.Element {
  return (
    <div className="flex h-16 shrink-0 items-center justify-center border-b border-border px-0">
      <div className="relative group">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground shadow-sm">C</div>
        <Button variant="secondary" size="sm" iconOnly tooltip="Expand sidebar" onClick={onToggle} className="absolute inset-0 flex items-center justify-center rounded-lg opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function SignOutLink({ locale, collapsed, density = 'compact' }: { locale: string; collapsed: boolean; density?: 'compact' | 'touch' }): React.JSX.Element {
  const anchor = (
    <a href={`/${locale}/auth/signout`} className={cn('flex items-center rounded-lg px-2.5 text-sm font-medium outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50', density === 'touch' ? 'h-11' : 'h-9', collapsed && 'w-9 justify-center px-0')}>
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

function NavGroup({ section, collapsed }: { section: ShellNavSection; collapsed: boolean }): React.JSX.Element {
  return (
    <Fragment>
      {section.label && <SectionLabel label={section.label} collapsed={collapsed} />}
      {section.items.map((item: ShellNavItem) => (
        <SidebarNavItem key={item.id} item={item} collapsed={collapsed} />
      ))}
    </Fragment>
  );
}

function SidebarMainNav({ sections, collapsed }: { sections: readonly ShellNavSection[]; collapsed: boolean }): React.JSX.Element {
  return (
    <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto px-2 py-3 scrollbar-thin scrollbar-thumb-border hover:scrollbar-thumb-muted-foreground/40">
      {sections.map((section) => (
        <NavGroup key={section.groupId ?? 'ungrouped'} section={section} collapsed={collapsed} />
      ))}
    </nav>
  );
}

export interface SidebarProps {
  className?: string;
  locale: string;
  permissionKeys: readonly string[];
  initialExpanded?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ className, locale, permissionKeys, initialExpanded = true }) => {
  const [expanded, setExpanded] = useState<boolean>(initialExpanded);
  const dictionary = useDictionary();
  const sections = useMemo(
    () => buildShellSections(new Set(permissionKeys), 'sidebar', locale, dictionary),
    [permissionKeys, locale, dictionary],
  );

  function handleToggle(): void {
    const next = !expanded;
    setExpanded(next);
    persistExpandedPreference(next);
  }

  return (
    <aside className={cn('sticky top-0 relative flex h-screen shrink-0 flex-col border-r border-border bg-background/95 backdrop-blur transition-[width] duration-200', expanded ? 'w-56' : 'w-14', className)}>
      {expanded ? <ExpandedBrandRow onToggle={handleToggle} /> : <CollapsedBrandRow onToggle={handleToggle} />}
      <SidebarMainNav sections={sections} collapsed={!expanded} />
      <div className="shrink-0 border-t border-border px-2 py-3">
        <SignOutLink locale={locale} collapsed={!expanded} />
      </div>
    </aside>
  );
};
