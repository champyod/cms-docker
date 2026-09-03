import { getTasks } from '@/app/actions/tasks';
import { TaskList } from '@/components/tasks/TaskList';
import { checkPermission, getPermissions } from '@/lib/permissions';
import { getDictionary } from '@/i18n';
import { notFound } from 'next/navigation';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';

export default async function TasksPage({
  params: paramsPromise,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; search?: string }>;
}) {
  const { locale } = await paramsPromise;
  const dict = await getDictionary(locale);
  const hasPermission = await checkPermission('tasks', false);

  // Why: return 404 for forbidden access so existence is indistinguishable from missing page
  if (!hasPermission) {
    notFound();
  }

  const permissions = await getPermissions();
  const params = await searchParams;
  const page = parseInt(params.page || '1', 10);
  const search = params.search || '';

  const { tasks, totalPages } = await getTasks({ page, search });

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <Text variant="h1">{dict.tasks.title}</Text>
        <Text variant="muted">{dict.tasks.subtitle}</Text>
      </Stack>

      <TaskList initialTasks={tasks} totalPages={totalPages} permissions={permissions} />
    </Stack>
  );
}
