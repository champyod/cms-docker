import { getTasks } from '@/app/actions/tasks';
import { RecordListPager } from '@/components/list/RecordListPager';
import { ListPage } from '@/components/patterns/ListPage';
import { TaskList } from '@/components/tasks/TaskList';
import { TaskListHeader } from '@/components/tasks/TaskListHeader';
import { TaskListToolbar } from '@/components/tasks/TaskListToolbar';
import { getDictionary } from '@/i18n';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { buildRoute } from '@/lib/navigation/routes';
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

  const { tasks, total, totalPages } = await getTasks({ page, search, sort });

  // Why a link and not a click handler: the page number is part of the request, so the pager
  // produces the address of the next page and the filter and sort the reader chose survive it.
  const hrefForPage = (next: number): string => {
    const query = new URLSearchParams();
    if (search) query.set('search', search);
    if (sort) {
      query.set('sort', sort.key);
      query.set('dir', sort.direction);
    }
    if (next > 1) query.set('page', String(next));
    const suffix = query.toString();
    return `${buildRoute(locale, 'tasks.list')}${suffix.length > 0 ? `?${suffix}` : ''}`;
  };

  return (
    <ListPage
      breadcrumbs={listBreadcrumbs(locale, 'direct', 'tasks.list', dict)}
      title={dict.tasks.title}
      description={dict.tasks.subtitle}
      actions={<TaskListHeader permissionKeys={Array.from(permissions)} />}
      toolbar={<TaskListToolbar initialSearch={search} />}
      footer={
        <RecordListPager
          currentPage={page}
          totalPages={totalPages}
          hrefForPage={hrefForPage}
          totalRows={total}
          rowLabel="tasks"
        />
      }
    >
      <TaskList initialTasks={tasks} permissionKeys={Array.from(permissions)} initialSort={sort} />
    </ListPage>
  );
}
