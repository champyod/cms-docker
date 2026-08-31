'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  BookOpen,
  Box,
  ChevronLeft,
  ChevronRight,
  FileCode,
  Globe,
  Home,
  LogOut,
  Palette,
  Rocket,
  Settings,
  Shield,
  Trophy,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/core/Button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export const SIDEBAR_STORAGE_KEY = 'cms-sidebar-expanded';
const SIDEBAR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

interface SidebarPermissions {
  permission_all: boolean;
  permission_tasks: boolean;
  permission_users: boolean;
  permission_contests: boolean;
  permission_messaging: boolean;
}

interface NavVisibility {
  superadmin: boolean;
  contests: boolean;
  tasks: boolean;
  users: boolean;
}

interface NavItemDef {
  label: string;
  icon: LucideIcon;
  buildHref: (locale: string) => string;
  isVisible: (visibility: NavVisibility) => boolean;
}

const DASHBOARD_ITEM: NavItemDef = {
  label: 'Dashboard',
  icon: Home,
  buildHref: (locale) => `/${locale}`,
  isVisible: () => true,
};

const DOCUMENTATION_ITEM: NavItemDef = {
  label: 'Documentation',
  icon: BookOpen,
  buildHref: (locale) => `/${locale}/docs`,
  isVisible: () => true,
};

const CONTEST_ITEMS: NavItemDef[] = [
  { label: 'Contests', icon: Trophy, buildHref: (l) => `/${l}/contests`, isVisible: (v) => v.contests },
  { label: 'Tasks', icon: FileCode, buildHref: (l) => `/${l}/tasks`, isVisible: (v) => v.tasks },
  { label: 'Submissions', icon: Activity, buildHref: (l) => `/${l}/submissions`, isVisible: (v) => v.contests },
  { label: 'Users', icon: Users, buildHref: (l) => `/${l}/users`, isVisible: (v) => v.users },
  { label: 'Teams', icon: Users, buildHref: (l) => `/${l}/teams`, isVisible: (v) => v.users },
];

const INFRASTRUCTURE_ITEMS: NavItemDef[] = [
  { label: 'Active Contest', icon: Rocket, buildHref: (l) => `/${l}/deployments`, isVisible: () => true },
  { label: 'Admins', icon: Shield, buildHref: (l) => `/${l}/admins`, isVisible: () => true },
  { label: 'Resources', icon: Activity, buildHref: (l) => `/${l}/resources`, isVisible: () => true },
  { label: 'Containers', icon: Box, buildHref: (l) => `/${l}/containers`, isVisible: () => true },
  { label: 'Ranking', icon: Globe, buildHref: (l) => `/${l}/ranking`, isVisible: () => true },
  { label: 'Appearance', icon: Palette, buildHref: (l) => `/${l}/appearance`, isVisible: () => true },
  { label: 'Maintenance', icon: Wrench, buildHref: (l) => `/${l}/maintenance`, isVisible: () => true },
  { label: 'Settings', icon: Settings, buildHref: (l) => `/${l}/settings`, isVisible: () => true },
];

function isActiveRoute(pathname: string, href: string, locale: string): boolean {
  return pathname === href || (href !== `/${locale}` && pathname.startsWith(href));
}

function persistExpandedPreference(expanded: boolean): void {
  const value = expanded ? '1' : '0';
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, value);
  } catch {
    // Storage may be blocked; cookie below remains the durable store.
  }
  document.cookie = `${SIDEBAR_STORAGE_KEY}=${value}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

interface NavItemProps {
  item: NavItemDef;
  locale: string;
  collapsed: boolean;
}

const NavItem = ({ item, locale, collapsed }: NavItemProps) => {
  const pathname = usePathname();
  const href = item.buildHref(locale);
  const isActive = isActiveRoute(pathname, href, locale);

  const link = (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex h-9 items-center rounded-lg px-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
        collapsed && 'w-9 justify-center px-0',
        isActive
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      )}
    >
      <item.icon className="size-4 shrink-0" aria-hidden />
      {!collapsed && <span className="ml-3 truncate">{item.label}</span>}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
};

const SectionLabel = ({ label, collapsed }: { label: string; collapsed: boolean }) => {
  if (collapsed) {
    return <div className="mx-auto my-3 h-px w-6 bg-border" role="presentation" />;
  }
  return (
    <p className="px-2.5 pt-4 pb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
      {label}
    </p>
  );
};

const SignOutLink = ({ locale, collapsed }: { locale: string; collapsed: boolean }) => {
  const anchor = (
    <a
      href={`/${locale}/auth/signout`}
      className={cn(
        'flex h-9 items-center rounded-lg px-2.5 text-sm font-medium outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
        collapsed && 'w-9 justify-center px-0'
      )}
    >
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
};

export interface SidebarProps {
  className?: string;
  locale: string;
  permissions?: SidebarPermissions;
  initialExpanded?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  className,
  locale,
  permissions,
  initialExpanded = true,
}) => {
  const [expanded, setExpanded] = useState(initialExpanded);

  const superadmin = permissions?.permission_all ?? false;
  const visibility: NavVisibility = {
    superadmin,
    contests: superadmin || (permissions?.permission_contests ?? false),
    tasks: superadmin || (permissions?.permission_tasks ?? false),
    users: superadmin || (permissions?.permission_users ?? false),
  };

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    persistExpandedPreference(next);
  };

  return (
    <aside
      className={cn(
        'sticky top-0 relative flex h-screen shrink-0 flex-col border-r border-border bg-background/95 backdrop-blur transition-[width] duration-200',
        expanded ? 'w-56' : 'w-14',
        className
      )}
    >
      {/* Toggle Button */}
      <div className="absolute top-20 -right-3 z-10">
        <Button
          variant="secondary"
          size="sm"
          iconOnly
          tooltip={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          onClick={handleToggle}
          className="rounded-full border border-border shadow-md"
        >
          {expanded ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
        </Button>
      </div>

      {/* Logo area */}
      <div
        className={cn(
          'flex h-16 shrink-0 items-center border-b border-border px-3',
          expanded ? 'gap-3' : 'justify-center px-0'
        )}
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground shadow-sm">
          C
        </div>
        {expanded && <span className="truncate font-semibold">CMS Admin</span>}
      </div>

      {/* Navigation */}
      <nav
        aria-label="Main navigation"
        className="flex-1 space-y-1 overflow-y-auto px-2 py-3 scrollbar-thin scrollbar-thumb-border hover:scrollbar-thumb-muted-foreground/40"
      >
        <NavItem item={DASHBOARD_ITEM} locale={locale} collapsed={!expanded} />

        <SectionLabel label="Contest" collapsed={!expanded} />
        {CONTEST_ITEMS.filter((item) => item.isVisible(visibility)).map((item) => (
          <NavItem key={item.label} item={item} locale={locale} collapsed={!expanded} />
        ))}

        {superadmin && (
          <>
            <SectionLabel label="Infrastructure" collapsed={!expanded} />
            {INFRASTRUCTURE_ITEMS.map((item) => (
              <NavItem key={item.label} item={item} locale={locale} collapsed={!expanded} />
            ))}
          </>
        )}
      </nav>

      {/* Footer actions */}
      <div className="shrink-0 space-y-1 border-t border-border px-2 py-3">
        <NavItem item={DOCUMENTATION_ITEM} locale={locale} collapsed={!expanded} />
        <SignOutLink locale={locale} collapsed={!expanded} />
      </div>
    </aside>
  );
};
