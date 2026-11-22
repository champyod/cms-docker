import { BrandingTab, ServicesGroup } from '@/components/appearance/AppearanceClient';
import { DisplayTab } from '@/components/appearance/DisplayTab';
import { SettingsPage, type SettingsGroup } from '@/components/patterns/SettingsPage';
import { readConfigToml } from '@/app/actions/appearance';
import { getDictionary } from '@/i18n';
import { withBasePath } from '@/lib/base-path';
import { buildRoute } from '@/lib/navigation/routes';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

/**
 * How the panel looks: the scoreboard's logo, the values config.toml holds, and this screen's own
 * density.
 *
 * WHY settings and not a tabbed workspace: the three areas are read in sequence and each reaches a
 * different audience - the logo reaches every visitor of the scoreboard, the service values describe
 * the whole host, the display choices reach only this browser - which is exactly the question the
 * settings layout forces each group to answer before the reader flips anything. The tabs hid that
 * difference behind a click.
 */
export default async function SystemAppearancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  await authorizeRoutePage('system.appearance');
  const [dict, toml] = await Promise.all([getDictionary(locale), readConfigToml()]);
  // Why the read fails the page rather than emptying the group: "no value" and "could not read" look
  // the same in a list of dashes, and this page's whole job is to state what the host is configured
  // with. The module's error boundary says which one happened.
  if (!toml.success) throw new Error(toml.error);

  const groups: readonly SettingsGroup[] = [
    {
      key: 'branding',
      title: 'Branding',
      description: 'The scoreboard logo this panel serves, and the path config.toml points at it.',
      scope: 'Everyone: the logo is stored in the database and hot-reloaded across every instance.',
      children: (
        <BrandingTab
          logoPreview={withBasePath('/api/ranking/logo')}
          logoHref={buildRoute(locale, 'ranking.board')}
          branding={{ rankingLogoPath: toml.values['RANKING_LOGO_PATH'] ?? '' }}
          readOnly
        />
      ),
    },
    {
      key: 'services',
      title: 'Services',
      description: 'The values config.toml holds for the ranking, contest, worker and infrastructure services.',
      scope: 'Everyone: these are this host’s values. Changing them recreates services, so the editor is System → Settings.',
      children: <ServicesGroup values={toml.values} missing={dict.common.notSet} />,
    },
    {
      key: 'display',
      title: 'Display',
      description: 'Density, text size and contrast for this browser.',
      scope: 'Your screen only: stored on this device and applied as soon as you choose.',
      children: <DisplayTab />,
    },
  ];

  return (
    <SettingsPage
      // The system module shell above renders the title, the description and the trail.
      ownsHeader={false}
      title={dict.navigation.system.appearance.label}
      groups={groups}
      saveBar={
        <p className="text-sm text-muted-foreground">
          Nothing on this page is saved: display choices apply at once on this device, and the
          branding and service values are read-only here.
        </p>
      }
    />
  );
}
