import { getTasks } from '@/app/actions/tasks';
import { TaskList } from '@/components/tasks/TaskList';
import { checkPermission } from '@/lib/permissions';
import { getDictionary } from '@/i18n';
import { PermissionDenied } from '@/components/PermissionDenied';
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

  if (!hasPermission) {
    return <PermissionDenied permission="permission_tasks" locale={locale} dict={dict} />;
  }

  const params = await searchParams;
  const page = parseInt(params.page || '1', 10);
  const search = params.search || '';

  const { tasks, totalPages, total } = await getTasks({ page, search });

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <Text variant="h1">Tasks</Text>
        <Text variant="muted">Manage programming tasks, statements, and test cases.</Text>
      </Stack>

      <TaskList initialTasks={tasks} totalPages={totalPages} />
    </Stack>
  );
}
