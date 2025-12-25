import { getSubmissions } from '@/app/actions/submissions';
import { SubmissionList } from '@/components/submissions/SubmissionList';
import { getDictionary } from '@/i18n';

export default async function SubmissionsPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string };
  searchParams: { page?: string, search?: string };
}) {
  const page = Number(searchParams.page) || 1;
  const search = searchParams.search || '';
  
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
