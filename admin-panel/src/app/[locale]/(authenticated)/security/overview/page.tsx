import { Card } from '@/components/core/Card';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
import { readBannedAddresses, readLoginLockouts } from '@/app/actions/securityBlocks';
import { readTlsState } from '@/app/actions/securityTls';
import { readWafState } from '@/app/actions/securityWaf';

export default async function SecurityOverviewPage(): Promise<React.JSX.Element> {
  await authorizeRoutePage('security.overview');
  const [waf, banned, lockouts, tls] = await Promise.all([
    readWafState(),
    readBannedAddresses(),
    readLoginLockouts(),
    readTlsState(),
  ]);
  const expiring = tls.lineages.filter((lineage) => lineage.expiresSoon);
  const cards = [
    { label: 'WAF', value: waf.containerStatus ?? 'not running' },
    { label: 'WAF alerts parsed', value: String(waf.alerts.length) },
    { label: 'Banned addresses', value: String(banned.bans.length) },
    { label: 'Open lockouts', value: String(lockouts.length) },
    { label: 'Certificates expiring soon', value: String(expiring.length) },
    { label: 'Host agent', value: banned.agentReported ? 'reporting' : 'not reporting' },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <Card key={card.label}>
          <p className="text-sm text-white/60">{card.label}</p>
          <p className="mt-1 font-mono text-2xl text-white">{card.value}</p>
        </Card>
      ))}
    </div>
  );
}
