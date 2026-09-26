'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDictionary } from '@/hooks/useDictionary';
import {
  buildShellItems,
  type ShellNavItem,
} from '@/components/navigation/shell-nav';
import { isActiveRoute } from '@/components/layout/SidebarNavItem';

interface MobileBottomBarProps {
  locale: string;
  permissionKeys: readonly string[];
  open: boolean;
  onToggle: () => void;
}

const SLOT_CLASSES =
  'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[0.625rem] font-medium transition-colors';

// Why a link and not a second disclosure: the People slot is the group entered
// through its first permitted route, and More is the control that opens the full
// tree. Making People a disclosure too would put two controls on the same overlay
// and change nothing a reader can reach, so the slot keeps the behaviour the
// retired mobile builder had — a tap goes to the first permitted People route.
function MobileSlot({ item, active }: { item: ShellNavItem; active: boolean }): React.JSX.Element {
  return (
    <Link href={item.href} aria-current={active ? 'page' : undefined} className={cn(SLOT_CLASSES, active ? 'text-primary' : 'text-muted-foreground hover:text-accent-foreground')}>
      <item.icon className="size-5 shrink-0" aria-hidden />
      <span className="max-w-full truncate">{item.label}</span>
    </Link>
  );
}

export function MobileBottomBar({ locale, permissionKeys, open, onToggle }: MobileBottomBarProps): React.JSX.Element {
  const dictionary = useDictionary();
  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const primary = useMemo(
    () => buildShellItems(effective, 'mobile-primary', locale, dictionary),
    [effective, locale, dictionary],
  );
  const pathname = usePathname();
  return (
    <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="flex h-16 items-stretch justify-around">
        {primary.map((item) => (
          <MobileSlot key={item.id} item={item} active={isActiveRoute(pathname ?? '', item.href, locale)} />
        ))}
        <button type="button" aria-expanded={open} aria-label="More" onClick={onToggle} className={cn(SLOT_CLASSES, open ? 'text-primary' : 'text-muted-foreground hover:text-accent-foreground')}>
          <MoreHorizontal className="size-5" aria-hidden />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}
