import { getSubmissions } from '@/app/actions/submissions';
import { SubmissionList } from '@/components/submissions/SubmissionList';
import { getDictionary } from '@/i18n';
import { checkPermission } from '@/lib/permissions';
import { PermissionDenied } from '@/components/PermissionDenied';
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

  if (!hasPermission) {
    return <PermissionDenied permission="permission_contests" locale={locale} dict={dict} />;
  }

  const sParams = await searchParams;
  const page = Number(sParams.page) || 1;

  const { submissions, totalPages } = await getSubmissions({ page });

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <Text variant="h1">Submissions</Text>
        <Text variant="muted">Monitor real-time submission activity and results.</Text>
      </Stack>

      <SubmissionList
        initialSubmissions={submissions}
        totalPages={totalPages}
        currentPage={page}
       />
    </Stack>
  );
}
