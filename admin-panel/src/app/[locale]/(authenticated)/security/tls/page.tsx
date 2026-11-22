import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
import { readTlsState } from '@/app/actions/securityTls';
import { TlsPanel } from '@/components/security/TlsPanel';
import { DetailPage } from '@/components/patterns/DetailPage';

export default async function SecurityTlsPage(): Promise<React.JSX.Element> {
  await authorizeRoutePage('security.tls');
  const state = await readTlsState();
  // The module shell above renders the title, the description and the trail.
  return (
    <DetailPage
      ownsHeader={false}
      title="TLS"
      facts={[
        { term: 'TLS proxy', value: state.proxyStatus ?? 'not running' },
        { term: 'Certbot', value: state.certbotStatus ?? 'not running' },
        { term: 'Lineages', value: String(state.lineages.length) },
      ]}
    >
      <TlsPanel state={state} />
    </DetailPage>
  );
}
