import { EnvConfigView } from '@/components/settings/EnvConfigView';

export default function SettingsPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">System Settings</h1>
        <p className="text-neutral-400 mt-2">Configure environment variables and system connections.</p>
      </div>

      <EnvConfigView />
    </div>
  );
}
