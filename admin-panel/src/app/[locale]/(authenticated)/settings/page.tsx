import { EnvConfigView } from '@/components/settings/EnvConfigView';
import { WorkerNodesConfig } from '@/components/settings/WorkerNodesConfig';

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">System Settings</h1>
        <p className="text-neutral-400">Configure environment, services, and worker connections.</p>
      </div>

      <EnvConfigView />

      <WorkerNodesConfig />
    </div>
  );
}
