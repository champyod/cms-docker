'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buildMobilePrimary, buildVisibility, type SidebarPermissions } from '@/components/layout/sidebar-nav';
import { isActiveRoute } from '@/components/layout/SidebarNavItem';

interface MobileBottomBarProps {
  locale: string;
  permissions?: SidebarPermissions;
  open: boolean;
  onToggle: () => void;
}

export function MobileBottomBar({ locale, permissions, open, onToggle }: MobileBottomBarProps): React.JSX.Element {
  const visibility = buildVisibility(permissions);
  const primary = buildMobilePrimary(visibility);
  const pathname = usePathname();
  return (
    <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="flex h-16 items-stretch justify-around">
        {primary.map((item) => {
          const href = item.buildHref(locale);
          const isActive = isActiveRoute(pathname, href, locale);
          return (
            <Link key={item.label} href={href} aria-current={isActive ? 'page' : undefined} className={cn('flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors', isActive ? 'text-primary' : 'text-muted-foreground hover:text-accent-foreground')}>
              <item.icon className="size-5 shrink-0" aria-hidden />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
        <button type="button" aria-expanded={open} aria-label="More" onClick={onToggle} className={cn('flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors', open ? 'text-primary' : 'text-muted-foreground hover:text-accent-foreground')}>
          <MoreHorizontal className="size-5" aria-hidden />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}
