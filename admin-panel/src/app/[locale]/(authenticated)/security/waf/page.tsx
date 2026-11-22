import { readWafState } from '@/app/actions/securityWaf';
import { getDictionary } from '@/i18n';
import { DetailPage } from '@/components/patterns/DetailPage';
import { WafPanel } from '@/components/security/WafPanel';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

/**
 * The WAF on this host: what it is doing, how it is tuned, and what it has just blocked.
 *
 * WHY a detail: the page is one subsystem, not a row set. Its three values - whether the container
 * runs, how many alerts parsed and how many lines did not - are the fact strip, and the settings and
 * the alerts are the sections that belong to it. The tuning card writes config.toml and recreates
 * the container, which is an action on this record, not a preference of the reader's screen.
 */
export default async function SecurityWafPage({ params }: { params: Promise<{ locale: string }> }): Promise<React.JSX.Element> {
  const { locale } = await params;
  await authorizeRoutePage('security.waf');
  const dictionary = await getDictionary(locale);
  const state = await readWafState();
  return (
    <DetailPage
      // The security module shell above renders the title, the description and the trail.
      ownsHeader={false}
      title="WAF"
      facts={[
        { term: 'Container', value: state.containerStatus ?? 'not running' },
        { term: 'Alerts parsed', value: String(state.alerts.length) },
        { term: 'Unparsed log lines', value: String(state.skippedAlertLines) },
      ]}
    >
      <WafPanel missing={dictionary.common.notSet} state={state} />
    </DetailPage>
  );
}
