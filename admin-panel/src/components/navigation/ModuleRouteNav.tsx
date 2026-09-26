'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { RouteId } from '@/lib/navigation/types';
import { cn } from '@/lib/utils';

export interface ModuleRouteNavItem {
  readonly id: RouteId;
  readonly label: string;
  readonly href: string;
}

interface ModuleRouteNavProps {
  readonly items: readonly ModuleRouteNavItem[];
  readonly ariaLabel: string;
}

// Why normalize: the router may hand back a trailing slash while the descriptor
// href never has one, so an exact string compare would drop the active state.
function normalizePath(value: string): string {
  return value === '/' ? value : value.replace(/\/+$/, '');
}

export function ModuleRouteNav({
  items,
  ariaLabel,
}: ModuleRouteNavProps): React.JSX.Element | null {
  const pathname = usePathname();
  if (items.length === 0) return null;
  return (
    <nav
      aria-label={ariaLabel}
      className="mb-4 flex min-w-0 gap-1 overflow-x-auto border-b border-border"
    >
      {items.map((item) => {
        const isActive = normalizePath(pathname) === normalizePath(item.href);
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'min-h-11 shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
