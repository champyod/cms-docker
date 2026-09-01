'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Bell, Search, User } from 'lucide-react';
import { useToast } from '../providers/ToastProvider';
import { getUnansweredQuestions } from '@/app/actions/questions';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from './ThemeToggle';
import { Button } from '@/components/core/Button';
import { CommandPalette } from '../palette/CommandPalette';

export const Header: React.FC<{ className?: string; username?: string }> = ({ className, username }) => {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [hasNotifications, setHasNotifications] = useState(false);
  const lastCheckTimeRef = useRef(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const authenticationExpiredRef = useRef(false);
  const { addToast } = useToast();
  const router = useRouter();

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const handleAuthenticationExpired = useCallback(() => {
    // Why: after 401 the session is invalid so polling would spam errors — stop and redirect once
    if (authenticationExpiredRef.current) return;
    authenticationExpiredRef.current = true;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const segments = window.location.pathname.split('/');
    const locale = segments[1] || 'en';
    router.push(`/${locale}/auth/login`);
  }, [router]);

  // Poll for new questions every 30 seconds
  useEffect(() => {
    const checkNotifications = async () => {
      if (authenticationExpiredRef.current) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        return;
      }
      try {
        const questions = await getUnansweredQuestions(null);

        if (questions && questions.length > 0) {
          setHasNotifications(true);

          const latest = questions[0];
          const qTime = new Date(latest.question_timestamp).getTime();

          if (qTime > lastCheckTimeRef.current) {
            addToast({
              type: 'warning',
              title: 'New Question Received!',
              message: `From ${latest.participations?.users?.username || 'User'}: ${latest.subject.substring(0, 30)}...`,
              duration: Infinity
            });
            lastCheckTimeRef.current = Date.now();
          }
        } else {
          setHasNotifications(false);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '';
        const isAuthenticationError = message.includes('Unauthorized') || message.includes('Missing') || message.includes('permission');
        if (isAuthenticationError) {
          handleAuthenticationExpired();
          return;
        }
        console.error('Failed to check notifications', error);
      }
    };

    const handleExternalExpiration = () => {
      handleAuthenticationExpired();
    };

    window.addEventListener('cms-authentication-expired', handleExternalExpiration);

    // Initial check
    checkNotifications();

    intervalRef.current = setInterval(checkNotifications, 30 * 1000);

    return () => {
      window.removeEventListener('cms-authentication-expired', handleExternalExpiration);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [addToast, handleAuthenticationExpired, stopPolling]);

  const handleNotificationsClick = () => {
    const locale = window.location.pathname.split('/')[1] || 'en';
    router.push(`/${locale}/contests`);
  };

  return (
    <header
      className={cn(
        'sticky top-0 z-10 flex h-16 shrink-0 items-center justify-end gap-3 border-b border-border bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/75',
        className
      )}
    >
      {/* Single Search Trigger - opens Command Palette focused */}
      <div className="relative group">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <Search className="h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
        </div>
        <input
          readOnly
          role="button"
          aria-label="Search navigation, entities, and actions (Control plus K)"
          placeholder="Search navigation, entities, and actions..."
          onClick={() => setPaletteOpen(true)}
          onFocus={() => setPaletteOpen(true)}
          className="h-9 w-64 cursor-pointer rounded-full border border-input bg-muted/50 pl-9 pr-14 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        <kbd className="pointer-events-none absolute inset-y-0 right-2 my-auto hidden h-5 items-center rounded border border-border bg-muted px-1.5 font-mono text-xs font-semibold text-muted-foreground sm:inline-flex">
          ⌘K
        </kbd>
      </div>

      {/* Theme Toggle */}
      <ThemeToggle />

      {/* Notifications */}
      <Button variant="ghost" size="sm" iconOnly tooltip="Notifications" onClick={handleNotificationsClick}>
        <span className="relative flex">
          <Bell className="size-4" />
          {hasNotifications && (
            <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-destructive animate-pulse" />
          )}
        </span>
      </Button>

      {/* User Profile */}
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

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </header>
  );
};
