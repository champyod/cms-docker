import { ResourceView } from '@/components/resources/ResourceView';
import { checkPermission } from '@/lib/permissions';
import { getDictionary } from '@/i18n';
import { notFound } from 'next/navigation';
import { Text } from '@/components/core/Typography';
import { Stack } from '@/components/core/Layout';

export default async function ResourcesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const hasPermission = await checkPermission('all', false);

  // Why: return 404 for forbidden access so existence is indistinguishable from missing page
  if (!hasPermission) {
    notFound();
  }

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <Text variant="h1">{dict.resources.title}</Text>
        <Text variant="muted">{dict.resources.subtitle}</Text>
      </Stack>

      <ResourceView />
    </Stack>
  );
}
