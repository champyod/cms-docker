import React from 'react';
import { cn } from '@/lib/utils';
import { Bell, Search, User } from 'lucide-react';

export const Header: React.FC<{ className?: string; username?: string }> = ({ className, username }) => {
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
        <div className="relative group">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-slate-400 group-focus-within:text-indigo-400 transition-colors" />
          </div>
          <input
            type="text"
            className="glass-input pl-10 w-64 text-sm rounded-full bg-white/5 hover:bg-white/10 focus:bg-white/10 transition-all"
            placeholder="Search..."
          />
        </div>

        {/* Notifications */}
        <button className="p-2.5 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition-colors relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500 shadow-lg shadow-red-500/50 animate-pulse" />
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
