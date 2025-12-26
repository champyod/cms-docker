import { getDictionary } from '@/i18n';
import { Card } from '@/components/core/Card';
import { Settings as SettingsIcon, Bell, Lock, Globe, Shield } from 'lucide-react';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const dict = await getDictionary(locale);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Settings
        </h1>
        <p className="text-neutral-400">
          Configure system behavior and administrative preferences.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6 glass-card border-white/5 space-y-4">
          <div className="flex items-center gap-3 text-indigo-400">
            <SettingsIcon className="w-5 h-5" />
            <h2 className="text-lg font-semibold text-white">General Settings</h2>
          </div>
          <p className="text-sm text-neutral-400">
            Adjust global contest settings and system defaults.
          </p>
          <div className="pt-4 space-y-4">
               <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                   <span className="text-sm text-neutral-300">System Mode</span>
                   <span className="text-xs font-mono bg-indigo-500/20 text-indigo-300 px-2 py-1 rounded">PRODUCTION</span>
               </div>
               <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                   <span className="text-sm text-neutral-300">Default Locale</span>
                   <span className="text-xs font-mono bg-white/10 text-neutral-300 px-2 py-1 rounded">EN</span>
               </div>
          </div>
        </Card>

        <Card className="p-6 glass-card border-white/5 space-y-4">
          <div className="flex items-center gap-3 text-emerald-400">
            <Shield className="w-5 h-5" />
            <h2 className="text-lg font-semibold text-white">Security & Auth</h2>
          </div>
          <p className="text-sm text-neutral-400">
            Manage authentication methods and security policies.
          </p>
           <div className="pt-4 space-y-4">
               <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                   <span className="text-sm text-neutral-300">Password Policy</span>
                   <span className="text-xs font-mono bg-emerald-500/20 text-emerald-300 px-2 py-1 rounded">STRICT</span>
               </div>
               <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                   <span className="text-sm text-neutral-300">Session Timeout</span>
                   <span className="text-xs font-mono bg-white/10 text-neutral-300 px-2 py-1 rounded">2 Hours</span>
               </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
