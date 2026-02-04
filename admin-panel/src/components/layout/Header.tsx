'use client';

import React, { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Bell, Search, User, LogOut } from 'lucide-react';
import { useToast } from '../providers/ToastProvider';
import { getUnansweredQuestions } from '@/app/actions/questions';
import { useRouter } from 'next/navigation';

export const Header: React.FC<{ className?: string; username?: string }> = ({ className, username }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [hasNotifications, setHasNotifications] = useState(false);
  const lastCheckTimeRef = useRef(Date.now());
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const { addToast } = useToast();
  const router = useRouter();

  // Poll for new questions every 30 seconds
  useEffect(() => {
    const checkNotifications = async () => {
      // For polling, we might want to check for ALL contests or just active one?
      // Since we don't have active contest ID easily available in Header, 
      // let's assume we check for a dummy or make getUnansweredQuestions handle null (all contests).
      // Updated getUnansweredQuestions handles null by returning empty, we need to update it to return ALL if null.
      // Or better, let's just checking for a default contest ID 1 for now or pass it as prop?
      // Actually, Header doesn't know contest ID. 
      // Let's modify getUnansweredQuestions to accept null and find ALL unanswered questions across contests.

      try {
        // We will need to update server action to run without contestId filtering if null passed
        // For now, let's try with contestId 1 or find a way.
        // Actually, the best way is to fetch ALL.

        // Assuming we update the server action to handle null = all
        const questions = await getUnansweredQuestions(null);

        if (questions && questions.length > 0) {
          setHasNotifications(true);

          // Check if any came in recently (since last check) to toast
          // For simplicity, just toast if we have any and it's the first load or count increased?
          // Let's just toast for the latest one if it's new.
          const latest = questions[0];
          const qTime = new Date(latest.question_timestamp).getTime();

          if (qTime > lastCheckTimeRef.current) {
            addToast({
              type: 'warning',
              title: 'New Question Received!',
              message: `From ${latest.participations?.users?.username || 'User'}: ${latest.subject.substring(0, 30)}...`,
              duration: Infinity // Persistent as requested
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

  return (
    <header className={cn("flex items-center justify-between h-20 px-8", className)}>
      {/* Page Title / Breadcrumbs */}
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-slate-400">Overview of system status</p>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-4">
        {/* Search Bar */}
        <form onSubmit={handleSearch} className="relative group">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-slate-400 group-focus-within:text-indigo-400 transition-colors" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="glass-input pl-10 w-64 text-sm rounded-full bg-white/5 hover:bg-white/10 focus:bg-white/10 transition-all text-white placeholder-slate-500"
            placeholder="Search..."
          />
        </form>

        {/* Notifications */}
        <button
          className="p-2.5 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition-colors relative"
          onClick={() => {
            const locale = window.location.pathname.split('/')[1] || 'en';
            router.push(`/${locale}/contests`);
          }}
        >
          <Bell className="w-5 h-5" />
          {hasNotifications && (
            <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500 shadow-lg shadow-red-500/50 animate-pulse" />
          )}
        </button>

        {/* User Profile */}
        <div className="flex items-center gap-3 pl-4 border-l border-white/10">
            <div className="text-right hidden md:block">
            <p className="text-sm font-medium text-white">{username || 'Admin User'}</p>
            <p className="text-xs text-slate-400">Admin</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-500 to-cyan-500 p-[2px]">
                <div className="w-full h-full rounded-full bg-slate-950 flex items-center justify-center overflow-hidden">
                    <User className="w-5 h-5 text-slate-300" />
                </div>
            </div>
        </div>
      </div>
    </header>
  );
};
