import { ModuleRouteNav } from '@/components/navigation/ModuleRouteNav';
import { getDictionary } from '@/i18n';
import { concealedPermissions, permittedNavItems } from '@/lib/navigation/module-nav';

const GROUP_ID = 'system';

export default async function SystemLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const [dict, effective] = await Promise.all([
    getDictionary(locale),
    concealedPermissions(),
  ]);
  return (
    <>
      <ModuleRouteNav
        items={permittedNavItems(GROUP_ID, locale, dict, effective)}
        ariaLabel={dict['navigation']['groups'][GROUP_ID]}
      />
      {children}
    </>
  );
}
