'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Home, Users, Trophy, Settings, LogOut, ChevronRight, FileCode, Activity } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface SidebarItemProps {
  icon: React.ElementType;
  label: string;
  href: string;
  collapsed?: boolean;
}

const SidebarItem: React.FC<SidebarItemProps> = ({ icon: Icon, label, href, collapsed }) => {
  const pathname = usePathname();
  // Simple check for active state - usually you'd check if pathname starts with href for nested match
  // Assuming href is like '/en' or '/en/users'
  const isActive = pathname === href || (href !== '/en' && pathname.startsWith(href));

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center w-full p-3 rounded-xl transition-all duration-200 group relative",
        isActive 
          ? "bg-indigo-600/20 text-indigo-300" 
          : "hover:bg-white/5 text-slate-400 hover:text-white",
        collapsed && "justify-center"
      )}
    >
      <Icon className={cn("w-5 h-5", isActive && "text-indigo-400")} />
      {!collapsed && (
        <span className="ml-3 font-medium text-sm">{label}</span>
      )}
      {!collapsed && isActive && (
        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
      )}
    </Link>
  );
};

export const Sidebar: React.FC<{ className?: string, locale: string }> = ({ className, locale }) => {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <aside 
      className={cn(
        "flex flex-col h-screen py-6 pl-4 transition-all duration-300",
        collapsed ? "w-24" : "w-72",
        className
      )}
    >
      <div className={cn(
        "flex-1 flex flex-col glass-panel rounded-3xl p-4 relative transition-all duration-300",
        collapsed && "items-center"
      )}>
        {/* Toggle Button */}
        <button 
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-8 bg-indigo-600 rounded-full p-1 shadow-lg border border-indigo-400/50 text-white hover:bg-indigo-500 transition-colors z-10"
        >
          <ChevronRight className={cn("w-4 h-4 transition-transform", !collapsed && "rotate-180")} />
        </button>

        {/* Logo area */}
        <div className={cn("mb-10 px-2 flex items-center", collapsed && "justify-center")}>
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <span className="font-bold text-white text-lg">C</span>
          </div>
          {!collapsed && (
            <span className="ml-3 font-bold text-lg bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
              CMS Admin
            </span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-2">
          <SidebarItem icon={Home} label="Dashboard" href={`/${locale}`} collapsed={collapsed} />
          <SidebarItem icon={Users} label="Users" href={`/${locale}/users`} collapsed={collapsed} />
          <SidebarItem icon={Trophy} label="Contests" href={`/${locale}/contests`} collapsed={collapsed} />
          <SidebarItem icon={FileCode} label="Submissions" href={`/${locale}/submissions`} collapsed={collapsed} />
          <SidebarItem icon={Activity} label="Resources" href={`/${locale}/resources`} collapsed={collapsed} />
          <SidebarItem icon={Settings} label="Settings" href={`/${locale}/settings`} collapsed={collapsed} />
        </nav>

        {/* Footer actions */}
        <div className="mt-auto pt-4 border-t border-white/5 space-y-2">
           {/* Logout usually redirects to auth page or api */}
           <a href={`/${locale}/auth/login`} className={cn(
               "flex items-center w-full p-3 rounded-xl transition-all duration-200 group relative hover:bg-white/5 text-slate-400 hover:text-white",
                collapsed && "justify-center"
           )}>
              <LogOut className="w-5 h-5" />
               {!collapsed && <span className="ml-3 font-medium text-sm">Sign Out</span>}
           </a>
        </div>
      </div>
    </aside>
  );
};
