import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
import { readTlsState } from '@/app/actions/securityTls';
import { TlsPanel } from '@/components/security/TlsPanel';

export default async function SecurityTlsPage(): Promise<React.JSX.Element> {
  await authorizeRoutePage('security.tls');
  const state = await readTlsState();
  return <TlsPanel state={state} />;
}
