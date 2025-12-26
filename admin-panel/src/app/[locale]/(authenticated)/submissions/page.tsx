import { getSubmissions } from '@/app/actions/submissions';
import { SubmissionList } from '@/components/submissions/SubmissionList';
import { getDictionary } from '@/i18n';

export default async function SubmissionsPage({
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
  
  const { submissions, totalPages } = await getSubmissions({ page, search });

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Submissions
        </h1>
        <p className="text-neutral-400">
          Monitor real-time submission activity and results.
        </p>
      </div>

      <SubmissionList 
        initialSubmissions={submissions} 
        totalPages={totalPages} 
        currentPage={page} 
       />
    </div>
  );
}
