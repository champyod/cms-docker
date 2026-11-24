import { readWafState } from '@/app/actions/securityWaf';
import { getDictionary } from '@/i18n';
import { formatCount } from '@/lib/format-number';
import { DetailPage } from '@/components/patterns/DetailPage';
import { WafPanel } from '@/components/security/WafPanel';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

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
