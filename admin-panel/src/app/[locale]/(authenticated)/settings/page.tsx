import { checkPermission } from '@/lib/permissions';
import { getDictionary } from '@/i18n';
import { notFound } from 'next/navigation';
import { EnvConfigView } from '@/components/settings/EnvConfigView';
import { MonitorConfigSection } from '@/components/settings/MonitorConfigSection';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';

export default async function SettingsPage({
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
        <Text variant="h1">{dict.settings.title}</Text>
        <Text variant="muted">{dict.settings.subtitle}</Text>
      </Stack>

      <EnvConfigView />

      <MonitorConfigSection />
    </Stack>
  );
}
