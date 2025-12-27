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

  // Serialize BigInts to avoid client-side errors
  const serializedTask = JSON.parse(JSON.stringify(task, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  ));

  return (
    <div className="space-y-8">
      <TaskDetailView task={serializedTask} />
    </div>
  );
}
