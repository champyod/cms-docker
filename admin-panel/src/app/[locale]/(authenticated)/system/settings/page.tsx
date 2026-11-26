import { EnvConfigView } from '@/components/settings/EnvConfigView';
import { MonitorConfigSection } from '@/components/settings/MonitorConfigSection';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

export default async function SystemSettingsPage(): Promise<React.JSX.Element> {
  await authorizeRoutePage('system.settings');
  return (
    <>
      <EnvConfigView />
      <MonitorConfigSection />
    </>
  );
}