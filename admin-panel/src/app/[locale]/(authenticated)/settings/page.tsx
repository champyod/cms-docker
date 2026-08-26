import { checkPermission } from '@/lib/permissions';
import { getDictionary } from '@/i18n';
import { PermissionDenied } from '@/components/PermissionDenied';
import { EnvConfigView } from '@/components/settings/EnvConfigView';
import { MonitorConfigSection } from '@/components/settings/MonitorConfigSection';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const hasPermission = await checkPermission('all', false);

  if (!hasPermission) {
    return <PermissionDenied permission="permission_all" locale={locale} dict={dict} />;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">System Settings</h1>
        <p className="text-neutral-400">Configure environment files and service restarts.</p>
      </div>

      <EnvConfigView />

      <MonitorConfigSection />
    </div>
  );
}
