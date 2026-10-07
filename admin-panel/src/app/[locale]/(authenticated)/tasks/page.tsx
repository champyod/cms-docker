import { getTasks } from '@/app/actions/tasks';
import { PageSurface } from '@/components/core/PageSurface';
import { TaskList } from '@/components/tasks/TaskList';
import { getDictionary } from '@/i18n';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { checkPermission, getPermissions } from '@/lib/permissions';
import { notFound } from 'next/navigation';

export default async function TasksPage({
  params: paramsPromise,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; search?: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await paramsPromise;
  const dict = await getDictionary(locale);
  const hasPermission = await checkPermission('task:list', false);

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
    <PageSurface
      breadcrumbs={listBreadcrumbs(locale, 'direct', 'tasks.list', dict)}
      title={dict.tasks.title}
      description={dict.tasks.subtitle}
    >
      <TaskList initialTasks={tasks} totalPages={totalPages} permissionKeys={Array.from(permissions)} />
    </PageSurface>
  );
}
