import { ResourceView } from '@/components/resources/ResourceView';

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
        <div className="p-6 bg-white/[0.02] rounded-xl border border-white/5">
          <h2 className="text-xl font-bold text-white mb-2">Worker Node Management</h2>
          <p className="text-sm text-neutral-400">
            Worker nodes are now configured per-contest in <strong>Infrastructure → Deployments</strong>.
            Each contest instance can have its own set of workers, and all workers are aggregated
            into the global cms.toml configuration.
          </p>
        </div>
      </div>
    </div>
  );
}
