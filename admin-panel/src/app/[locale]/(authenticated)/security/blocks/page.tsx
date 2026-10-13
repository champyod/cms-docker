import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
import { readBannedAddresses, readLoginLockouts } from '@/app/actions/securityBlocks';
import { readLoginExemptions } from '@/app/actions/securityExemptions';
import { BlocksPanel } from '@/components/security/BlocksPanel';

export default async function SecurityBlocksPage(): Promise<React.JSX.Element> {
  await authorizeRoutePage('security.blocks');
  const [banned, lockouts, exemptions] = await Promise.all([
    readBannedAddresses(),
    readLoginLockouts(),
    readLoginExemptions(),
  ]);
  return <BlocksPanel banned={banned} lockouts={lockouts} exemptions={exemptions} />;
}
