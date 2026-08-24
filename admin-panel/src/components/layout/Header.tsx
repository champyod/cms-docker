'use client';

import React, { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Bell, Search, User } from 'lucide-react';
import { useToast } from '../providers/ToastProvider';
import { getUnansweredQuestions } from '@/app/actions/questions';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from './ThemeToggle';
import { Button } from '@/components/core/Button';

export const Header: React.FC<{ className?: string; username?: string }> = ({ className, username }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [hasNotifications, setHasNotifications] = useState(false);
  const lastCheckTimeRef = useRef(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const { addToast } = useToast();
  const router = useRouter();

  // Poll for new questions every 30 seconds
  useEffect(() => {
    const checkNotifications = async () => {
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
      } catch (e) {
        console.error('Failed to check notifications', e);
      }
    };

    // Initial check
    checkNotifications();

    intervalRef.current = setInterval(checkNotifications, 30000); // 30s

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [addToast]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      const locale = window.location.pathname.split('/')[1] || 'en';
      router.push(`/${locale}/search?q=${encodeURIComponent(searchQuery)}`);
    }
  };

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
      {/* Search Bar */}
      <form onSubmit={handleSearch} className="relative group">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-9 w-56 rounded-full border border-input bg-muted/50 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          placeholder="Search..."
        />
      </form>

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
    </header>
  );
};
