import { getTasks } from '@/app/actions/tasks';
import { TaskList } from '@/components/tasks/TaskList';

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string }>;
}) {
  const params = await searchParams;
  const page = parseInt(params.page || '1', 10);
  const search = params.search || '';

  const { tasks, totalPages, total } = await getTasks({ page, search });

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Tasks
        </h1>
        <p className="text-neutral-400">
          Manage programming tasks, statements, and test cases.
        </p>
      </div>

      <TaskList initialTasks={tasks} totalPages={totalPages} />
    </div>
  );
}
