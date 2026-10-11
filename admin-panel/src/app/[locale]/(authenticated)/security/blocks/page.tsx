import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
import { readBannedAddresses, readLoginLockouts, readServerLoginLockouts } from '@/app/actions/securityBlocks';
import { BlocksPanel } from '@/components/security/BlocksPanel';

export default async function SecurityBlocksPage(): Promise<React.JSX.Element> {
  await authorizeRoutePage('security.blocks');
  const [banned, lockouts, serverLockouts] = await Promise.all([
    readBannedAddresses(),
    readLoginLockouts(),
    readServerLoginLockouts(),
  ]);
  return <BlocksPanel banned={banned} lockouts={lockouts} serverLockouts={serverLockouts} />;
}
