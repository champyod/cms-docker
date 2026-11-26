import { AppearanceClient } from '@/components/appearance/AppearanceClient';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

export default async function SystemAppearancePage(): Promise<React.JSX.Element> {
  await authorizeRoutePage('system.appearance');
  return <AppearanceClient />;
}