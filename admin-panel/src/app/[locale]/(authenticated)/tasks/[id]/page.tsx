import { getTask } from '@/app/actions/tasks';
import { notFound } from 'next/navigation';
import { TaskDetailView } from '@/components/tasks/TaskDetailView';

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const taskId = parseInt(id, 10);
  
  if (isNaN(taskId)) {
    notFound();
  }

  const task = await getTask(taskId);

  if (!task) {
    notFound();
  }

  // Serialize BigInts and Dates to avoid client-side errors
  const serialize = (obj: any): any => {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return obj.toString();
    if (obj instanceof Date) return obj.toISOString();
    if (Array.isArray(obj)) return obj.map(serialize);
    if (typeof obj === 'object') {
      const newObj: any = {};
      for (const key in obj) {
        newObj[key] = serialize(obj[key]);
      }
      return newObj;
    }
    return obj;
  };

  const serializedTask = serialize(task);

  return (
    <div className="space-y-8">
      <TaskDetailView task={serializedTask} />
    </div>
  );
}
