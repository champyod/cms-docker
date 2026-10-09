import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
import { readBannedAddresses, readLoginLockouts } from '@/app/actions/securityBlocks';
import { BlocksPanel } from '@/components/security/BlocksPanel';

export default async function SecurityBlocksPage(): Promise<React.JSX.Element> {
  await authorizeRoutePage('security.blocks');
  const [banned, lockouts] = await Promise.all([readBannedAddresses(), readLoginLockouts()]);
  return <BlocksPanel banned={banned} lockouts={lockouts} />;
}
