'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { Bell, Search, User } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useAppRouter } from '@/hooks/useAppRouter';
import { buildRoute } from '@/lib/navigation/routes';
import { localeFromPathname } from '@/lib/navigation/breadcrumbs';
import { useLiveNotifications } from '@/lib/live/notifications';
import { ThemeToggle } from './ThemeToggle';
import { NotificationBell } from './NotificationBell';
import { Button } from '@/components/core/Button';
import { CommandPalette } from '../palette/CommandPalette';

/**
 * The header's two live signals: the alert bell and the unanswered-question dot.
 *
 * Why they render together: both read the one notification service, which holds the connections and
 * the alerting, so neither component has to know where its alerts came from.
 */
function HeaderNotifications({ permissionKeys }: { permissionKeys: readonly string[] }): React.JSX.Element {
  const keys = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const { events, unread, unansweredCount, clearEvents, markSeen } = useLiveNotifications();
  const router = useAppRouter();
  const pathname = usePathname();

  const openContestQuestions = (): void => {
    router.push(buildRoute(localeFromPathname(pathname), 'contests.list'));
  };

  return (
    <>
      {hasEffectivePermission(keys, 'audit:read') && (
        <NotificationBell
          events={events}
          unread={unread}
          onClear={clearEvents}
          onSeen={markSeen}
        />
      )}
      {hasEffectivePermission(keys, 'question:list') && (
        <Button variant="ghost" size="sm" iconOnly tooltip="Notifications" onClick={openContestQuestions}>
          <span className="relative flex">
            <Bell className="size-4" />
            {unansweredCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-destructive animate-pulse" />
            )}
          </span>
        </Button>
      )}
    </>
  );
}

export const Header: React.FC<{ className?: string; username?: string; permissionKeys: readonly string[] }> = ({ className, username, permissionKeys }) => {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const authenticationExpiredRef = useRef(false);
  const router = useAppRouter();
  const pathname = usePathname();

  // Why the header answers a dead session: it is mounted on every authenticated page, so it is the one
  // place a 401 raised anywhere in the panel is turned into a single redirect to the login page.
  useEffect(() => {
    const handleAuthenticationExpired = (): void => {
      if (authenticationExpiredRef.current) return;
      authenticationExpiredRef.current = true;
      router.push(`/${localeFromPathname(pathname)}/auth/login`);
    };

    window.addEventListener('cms-authentication-expired', handleAuthenticationExpired);
    return () => window.removeEventListener('cms-authentication-expired', handleAuthenticationExpired);
  }, [router, pathname]);

  return (
    <header
      className={cn(
        'sticky top-0 z-10 flex h-16 shrink-0 items-center justify-end gap-3 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:px-6',
        className
      )}
    >
      <button
        type="button"
        aria-label="Search navigation, entities, and actions (Control plus K)"
        onClick={() => setPaletteOpen(true)}
        className="group flex h-11 w-11 cursor-pointer items-center justify-center gap-2 rounded-full border border-input bg-muted/50 text-sm text-foreground outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 sm:h-9 sm:w-64 sm:justify-start sm:px-3"
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-focus-visible:text-primary" aria-hidden />
        <span className="hidden flex-1 truncate text-left text-muted-foreground sm:inline" aria-hidden>
          Search…
        </span>
        <kbd className="ml-auto hidden h-5 items-center rounded border border-border bg-muted px-1.5 font-mono text-xs font-semibold text-muted-foreground sm:inline-flex" aria-hidden>
          ⌘K
        </kbd>
      </button>
      <ThemeToggle />
      <HeaderNotifications permissionKeys={permissionKeys} />
      <div className="flex items-center gap-3 pl-4 border-l border-border">
        <div className="text-right hidden md:block">
          <p className="text-sm font-medium text-foreground">{username || 'Admin User'}</p>
          <p className="text-xs text-muted-foreground">Admin</p>
        </div>
        <div className="size-10 rounded-full bg-linear-to-tr from-primary to-info p-0.5">
          <div className="flex size-full items-center justify-center overflow-hidden rounded-full bg-card">
            <User className="size-5 text-muted-foreground" />
          </div>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} permissionKeys={permissionKeys} />
    </header>
  );
};
