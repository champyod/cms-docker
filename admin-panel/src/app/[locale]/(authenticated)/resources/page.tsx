import { ResourceView } from '@/components/resources/ResourceView';
import { WorkerNodesConfig } from '@/components/settings/WorkerNodesConfig';

export default async function ResourcesPage() {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Resource Control
        </h1>
        <p className="text-neutral-400">
          Monitor and manage main server resources and distributed worker activity.
        </p>
      </div>

      <ResourceView />

      <div className="pt-8 border-t border-white/5">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-white">Worker Node Management</h2>
          <p className="text-sm text-neutral-400">Configure host and port settings in cms.toml</p>
        </div>
        <WorkerNodesConfig />
      </div>
    </div>
  );
}
