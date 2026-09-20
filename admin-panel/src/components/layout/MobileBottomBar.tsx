'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buildMobilePrimary } from '@/lib/nav-registry';
import { isActiveRoute } from '@/components/layout/SidebarNavItem';
import { useMemo } from 'react';

interface MobileBottomBarProps {
  locale: string;
  permissionKeys: readonly string[];
  open: boolean;
  onToggle: () => void;
}

export function MobileBottomBar({ locale, permissionKeys, open, onToggle }: MobileBottomBarProps): React.JSX.Element {
  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const primary = buildMobilePrimary(effective);
  const pathname = usePathname();
  return (
    <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="flex h-16 items-stretch justify-around">
        {primary.map((entry) => {
          const href = entry.path === '/' ? `/${locale}` : `/${locale}${entry.path}`;
          const isActive = isActiveRoute(pathname, href, locale);
          return (
            <Link key={entry.label} href={href} aria-current={isActive ? 'page' : undefined} className={cn('flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[0.625rem] font-medium transition-colors', isActive ? 'text-primary' : 'text-muted-foreground hover:text-accent-foreground')}>
              <entry.icon className="size-5 shrink-0" aria-hidden />
              <span className="max-w-full truncate">{entry.label}</span>
            </Link>
          );
        })}
        <button type="button" aria-expanded={open} aria-label="More" onClick={onToggle} className={cn('flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[0.625rem] font-medium transition-colors', open ? 'text-primary' : 'text-muted-foreground hover:text-accent-foreground')}>
          <MoreHorizontal className="size-5" aria-hidden />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}
