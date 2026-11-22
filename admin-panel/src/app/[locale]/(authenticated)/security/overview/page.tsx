import { Card } from '@/components/core/Card';
import { DashboardPage } from '@/components/patterns/DashboardPage';
import { SecuritySignalCard } from '@/components/security/SecuritySignalCard';
import { getDictionary } from '@/i18n';
import { formatInZone } from '@/lib/timezone';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
import { readBannedAddresses, readLoginLockouts } from '@/app/actions/securityBlocks';
import { readPatchingState } from '@/app/actions/securityPatching';
import { readTlsState } from '@/app/actions/securityTls';
import { readWafState } from '@/app/actions/securityWaf';

export default async function SecurityOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  await authorizeRoutePage('security.overview');
  const [waf, banned, lockouts, tls, patching, dict] = await Promise.all([
    readWafState(),
    readBannedAddresses(),
    readLoginLockouts(),
    readTlsState(),
    // Why the page action and not a query of its own: the four patching cards must show the
    // same numbers the patching page lists, and two reads would be two definitions of
    // "unresolved" the day one of them changes.
    readPatchingState(),
    getDictionary(locale),
  ]);
  const expiring = tls.lineages.filter((lineage) => lineage.expiresSoon);
  const labels = dict.security.overview.cards;
  const values = dict.security.overview.values;
  const cards = [
    { label: labels.waf, value: waf.containerStatus ?? values.notRunning },
    { label: labels.wafAlerts, value: String(waf.alerts.length) },
    { label: labels.banned, value: String(banned.bans.length) },
    { label: labels.lockouts, value: String(lockouts.length) },
    { label: labels.certsExpiring, value: String(expiring.length) },
    { label: labels.hostAgent, value: banned.agentReported ? values.reporting : values.notReporting },
    { label: dict.security.patching.cards.staleImages, value: String(patching.cards.staleImages) },
    { label: dict.security.patching.cards.unresolvedCves, value: String(patching.cards.unresolvedCves) },
    { label: dict.security.patching.cards.expiredWaivers, value: String(patching.cards.expiredWaivers) },
    { label: dict.security.patching.cards.hostOsUpdates, value: String(patching.cards.hostOsUpdates) },
  ];
  // The reads above just happened, so the page states when - the same sentence the home
  // dashboard uses, because "how old is this" must read the same way on both.
  const checkedAt = formatInZone(new Date().toISOString());
  return (
    <DashboardPage
      breadcrumbs={[]}
      title=""  // the security module shell renders this page's name and trail
      ownsHeader={false}
      state={<SecuritySignalCard digest={patching.signal} locale={locale} copy={dict.security.signal} />}
    >
      <p className="text-muted-foreground">{dict.dashboard.checkedAt.replace('{count}', checkedAt)}</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.label}>
            <p className="text-sm text-muted-foreground">{card.label}</p>
            <p className="mt-1 font-mono text-2xl text-foreground">{card.value}</p>
          </Card>
        ))}
      </div>
    </DashboardPage>
  );
}
