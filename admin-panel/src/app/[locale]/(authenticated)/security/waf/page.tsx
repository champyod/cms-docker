import { readWafState } from '@/app/actions/securityWaf';
import { getDictionary } from '@/i18n';
import { formatCount } from '@/lib/format-number';
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
  const copy = dictionary.security.waf;
  const state = await readWafState();
  return (
    <DetailPage
      // The security module shell above renders the title, the description and the trail.
      ownsHeader={false}
      facts={[
        { term: copy.facts.container, value: state.containerStatus ?? copy.notRunning },
        { term: copy.facts.alertsParsed, value: formatCount(state.alerts.length, locale) },
        { term: copy.facts.unparsedLines, value: formatCount(state.skippedAlertLines, locale) },
      ]}
    >
      <WafPanel missing={dictionary.common.notSet} state={state} />
    </DetailPage>
  );
}
