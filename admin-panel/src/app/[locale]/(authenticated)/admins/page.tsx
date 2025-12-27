import { getAdmins } from '@/app/actions/admins';
import { AdminList } from '@/components/admins/AdminList';

export default async function AdminsPage() {
  const admins = await getAdmins();

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Administrators
        </h1>
        <p className="text-neutral-400">
          Manage admin accounts and permissions.
        </p>
      </div>

      <AdminList initialAdmins={admins} />
    </div>
  );
}
