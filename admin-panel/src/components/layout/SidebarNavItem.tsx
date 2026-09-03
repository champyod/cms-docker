'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { NavItemDef } from '@/components/layout/sidebar-nav';

function isActiveRoute(pathname: string, href: string, locale: string): boolean {
  return pathname === href || (href !== `/${locale}` && pathname.startsWith(href));
}

interface NavItemProps {
  item: NavItemDef;
  locale: string;
  collapsed: boolean;
}

export function SidebarNavItem({ item, locale, collapsed }: NavItemProps): React.JSX.Element {
  const pathname = usePathname();
  const href = item.buildHref(locale);
  const isActive = isActiveRoute(pathname, href, locale);
  const link = (
    <Link href={href} aria-current={isActive ? 'page' : undefined} className={cn('flex h-9 items-center rounded-lg px-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50', collapsed && 'w-9 justify-center px-0', isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground')}>
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
}

export function SectionLabel({ label, collapsed }: { label: string; collapsed: boolean }): React.JSX.Element {
  if (collapsed) return <div className="mx-auto my-3 h-px w-6 bg-border" role="presentation" />;
  return <p className="px-2.5 pt-4 pb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</p>;
}
