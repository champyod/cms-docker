import { getTasks } from '@/app/actions/tasks';
import { PageSurface } from '@/components/core/PageSurface';
import { TaskList } from '@/components/tasks/TaskList';
import { getDictionary } from '@/i18n';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { readListSort } from '@/lib/list-sorting';
import { checkPermission, getPermissions } from '@/lib/permissions';
import { notFound } from 'next/navigation';

export default async function TasksPage({
  params: paramsPromise,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; search?: string; sort?: string; dir?: string }>;
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
  const sort = readListSort({ sort: params.sort, dir: params.dir });

  const { tasks, totalPages } = await getTasks({ page, search, sort });

  return (
    <PageSurface
      breadcrumbs={listBreadcrumbs(locale, 'direct', 'tasks.list', dict)}
      title={dict.tasks.title}
      description={dict.tasks.subtitle}
    >
      <TaskList initialTasks={tasks} totalPages={totalPages} currentPage={page} permissionKeys={Array.from(permissions)} initialSort={sort} />
    </PageSurface>
  );
}
