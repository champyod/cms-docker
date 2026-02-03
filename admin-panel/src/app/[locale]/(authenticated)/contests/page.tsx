import { getContests } from '@/app/actions/contests';
import { ContestList } from '@/components/contests/ContestList';
import { getDictionary } from '@/i18n';
import { checkPermission } from '@/lib/permissions';
import { redirect } from 'next/navigation';

export default async function ContestsPage({
  params,
  searchParams,
}: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ page?: string; search?: string }>;
}) {
  const { locale } = await params;
  if (!await checkPermission('contests', false)) redirect(`/${locale}`);

  const sParams = await searchParams;
  const page = Number(sParams.page) || 1;
  const search = sParams.search || '';

  const { contests, totalPages } = await getContests({ page, search });
  const dict = await getDictionary(locale);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Contests Management
        </h1>
        <p className="text-neutral-400">
          Create and manage programming contests.
        </p>
      </div>

      <ContestList initialContests={contests} totalPages={totalPages} />
    </div>
  );
}
