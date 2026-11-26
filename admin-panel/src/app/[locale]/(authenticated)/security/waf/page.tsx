import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
import { readWafState } from '@/app/actions/securityWaf';
import { WafPanel } from '@/components/security/WafPanel';

export default async function SecurityWafPage(): Promise<React.JSX.Element> {
  await authorizeRoutePage('security.waf');
  const state = await readWafState();
  return <WafPanel state={state} />;
}
