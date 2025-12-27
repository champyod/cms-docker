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
    </div>
  );
}
