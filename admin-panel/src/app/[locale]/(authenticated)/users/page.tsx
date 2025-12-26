import { getUsers } from '@/app/actions/users';
import { UserList } from '@/components/users/UserList';
import { getDictionary } from '@/i18n';

export default async function UsersPage({
  params,
  searchParams,
}: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ page?: string; search?: string }>;
}) {
  const { locale } = await params;
  const sParams = await searchParams;
  const page = Number(sParams.page) || 1;
  const search = sParams.search || '';
  
  const { users, totalPages } = await getUsers({ page, search });
  const dict = await getDictionary(locale);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">
          User Management
        </h1>
        <p className="text-neutral-400">
          Manage system users and participants.
        </p>
      </div>

      <UserList initialUsers={users} totalPages={totalPages} />
    </div>
  );
}
