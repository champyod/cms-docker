import { SettingsPage, type SettingsGroup } from '@/components/patterns/SettingsPage';
import { MaintenanceBackupsCard } from '@/components/system/MaintenanceBackupsCard';
import { MaintenanceNotificationsCard } from '@/components/system/MaintenanceNotificationsCard';
import { MaintenanceProvider, MaintenanceSaveBar } from '@/components/system/MaintenanceSurface';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

/**
 * What the host does on its own: the backup policy it runs under, and where it reports.
 *
 * WHY settings: both groups change how this deployment behaves for everybody - the dump schedule
 * runs on the host, the webhook posts every alert - and each states who it reaches before the reader
 * edits it. The backup policy waits for the page's save; the notification group saves itself, which
 * is why the save bar is the policy's own press and not a second one for the webhook.
 */
export default async function SystemMaintenancePage({ params }: {
  params: Promise<{ locale: 'en' | 'th' }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const effective = await authorizeRoutePage('system.maintenance');
  const dict = await getDictionary(locale);
  const groups: readonly SettingsGroup[] = [
    {
      key: 'backups',
      title: 'Submissions backup',
      description: 'How often the database is dumped, how many archives are kept, how old and how large they may grow, and what is already on disk.',
      scope: 'Everyone: the policy runs on this host for the whole deployment, and a manual backup obeys the same cleanup.',
      children: <MaintenanceBackupsCard />,
    },
    {
      key: 'notifications',
      title: 'Discord notifications',
      description: 'The webhook the monitor posts to, the role it mentions, and the events it reports.',
      scope: 'Everyone: every alert this host raises lands in that channel, including backup failures and container restarts.',
      children: <MaintenanceNotificationsCard />,
    },
  ];
  return (
    <MaintenanceProvider locale={locale} permissionKeys={[...effective]}>
      <SettingsPage
        // The system module shell above renders the title, the description and the trail.
        ownsHeader={false}
        groups={groups}
        saveBar={<MaintenanceSaveBar />}
      />
    </MaintenanceProvider>
  );
}
