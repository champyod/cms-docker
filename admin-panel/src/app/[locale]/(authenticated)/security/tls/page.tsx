import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
import { readTlsState } from '@/app/actions/securityTls';
import { TlsPanel } from '@/components/security/TlsPanel';
import { DetailPage } from '@/components/patterns/DetailPage';
import { getDictionary } from '@/i18n';

export default async function SecurityTlsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  await authorizeRoutePage('security.tls');
  const [state, dict] = await Promise.all([readTlsState(), getDictionary(locale)]);
  const copy = dict.security.tls;

  // The security module shell renders this page's name, description and trail from the navigation
  // registry, so the page supplies its facts and its panel.
  return (
    <DetailPage
      ownsHeader={false}
      locale={locale}
      facts={[
        { term: copy.proxy, value: state.proxyStatus ?? copy.notRunning },
        { term: copy.certbot, value: state.certbotStatus ?? copy.notRunning },
        // A count is passed as a number: the layout groups it, so the page does not have to.
        { term: copy.lineages, value: state.lineages.length },
      ]}
    >
      <TlsPanel state={state} />
    </DetailPage>
  );
}
