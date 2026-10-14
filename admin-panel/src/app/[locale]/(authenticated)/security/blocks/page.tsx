import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
import { readBannedAddresses, readLoginActivity, readLoginLockouts } from '@/app/actions/securityBlocks';
import { readLoginExemptions } from '@/app/actions/securityExemptions';
import { BlocksPanel } from '@/components/security/BlocksPanel';
import { getDictionary } from '@/i18n';
import { readCaptchaStatus } from '@/lib/captcha-status';

export default async function SecurityBlocksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  await authorizeRoutePage('security.blocks');
  const [banned, lockouts, exemptions, activity] = await Promise.all([
    readBannedAddresses(),
    readLoginLockouts(),
    readLoginExemptions(),
    readLoginActivity(),
  ]);
  const [captcha, dict] = await Promise.all([
    readCaptchaStatus(activity.ok),
    getDictionary(locale),
  ]);
  return (
    <BlocksPanel
      banned={banned}
      lockouts={lockouts}
      exemptions={exemptions}
      activity={activity}
      captcha={captcha}
      captchaCopy={dict.security.blocks}
    />
  );
}
