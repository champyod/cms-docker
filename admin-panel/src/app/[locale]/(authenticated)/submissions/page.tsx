import { getSubmissions } from '@/app/actions/submissions';
import { SubmissionList } from '@/components/submissions/SubmissionList';
import { checkPermission } from '@/lib/permissions';
import { getDictionary } from '@/i18n';
import { notFound } from 'next/navigation';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';

export default async function SubmissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; search?: string }>;
}) {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const hasPermission = await checkPermission('contests', false);

  // Why: return 404 for forbidden access so existence is indistinguishable from missing page
  if (!hasPermission) {
    notFound();
  }

  const sParams = await searchParams;
  const page = Number(sParams.page) || 1;

  const { submissions, totalPages } = await getSubmissions({ page });

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <Text variant="h1">{dict.submissions.title}</Text>
        <Text variant="muted">{dict.submissions.subtitle}</Text>
      </Stack>

      <SubmissionList
        initialSubmissions={submissions}
        totalPages={totalPages}
        currentPage={page}
       />
    </Stack>
  );
}
