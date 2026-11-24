import { SettingsPage, type SettingsGroup } from '@/components/patterns/SettingsPage';
import { EnvConfigView } from '@/components/settings/EnvConfigView';
import { MonitorConfigSection } from '@/components/settings/MonitorConfigSection';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

const ENVIRONMENT: Omit<SettingsGroup, 'children'> = {
  key: 'environment',
  title: 'Environment',
  description:
    'The values config.toml holds: the database profile, the addresses the services bind, the panel port and the alert webhook.',
  scope:
    'Everyone: a save rewrites config.toml for this host, and a save with restart recreates every service that reads it.',
};

const MONITOR: Omit<SettingsGroup, 'children'> = {
  key: 'monitor',
  title: 'Monitor targets',
  description: 'The URLs the monitor checks, how often, and which response counts as healthy.',
  scope:
    'Everyone: the monitor runs for the whole host, so a target added here alerts on every channel it posts to.',
};

export default async function SystemSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  await authorizeRoutePage('system.settings');
  const dict = await getDictionary(locale);
  return (
    <SettingsPage
      // The module shell above renders the title, the description and the trail.
      ownsHeader={false}
      groups={[
        { ...ENVIRONMENT, children: <EnvConfigView /> },
        { ...MONITOR, children: <MonitorConfigSection /> },
      ]}
    />
  );
}
