import { readBannedAddresses, readLoginActivity, readLoginLockouts } from '@/app/actions/securityBlocks';
import { readLoginExemptions } from '@/app/actions/securityExemptions';
import { InlineAlert } from '@/components/core/InlineAlert';
import { BoardPage, type BoardSection } from '@/components/patterns/BoardPage';
import { BannedAddressList } from '@/components/security/BannedAddressList';
import { CaptchaStatusSummary } from '@/components/security/CaptchaStatusSummary';
import { ExemptionsPanel } from '@/components/security/ExemptionsPanel';
import { LockoutList } from '@/components/security/LockoutList';
import { LoginActivityTable } from '@/components/security/LoginActivityTable';
import { QueueUnbanForm } from '@/components/security/QueueUnbanForm';
import { getDictionary } from '@/i18n';
import { readCaptchaStatus } from '@/lib/captcha-status';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
import { listLoginSurfaces, surfaceLabels } from '@/lib/security/login-surfaces';

/**
 * Five record kinds share one page and none of them is the same record: a captcha setting, a host
 * ban, a standing exemption, a live failure counter and a lockout record. A board is the only
 * layout that lets each keep its own rows and its own meaning of empty without inventing one row
 * set and one total that the page cannot honestly fill.
 *
 * WHY the empty elements for bans and exemptions carry a form: those two sections exist to be
 * acted on, and the control that adds the first row has to survive the empty state — so the
 * section's empty is the sentence plus the control, not the sentence alone.
 */
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
  const [captcha, dict, surfaces] = await Promise.all([
    readCaptchaStatus(activity.ok),
    getDictionary(locale),
    listLoginSurfaces(),
  ]);
  const labels = surfaceLabels(surfaces);

  const sections: readonly BoardSection[] = [
    {
      key: 'captcha',
      title: dict.security.blocks.captchaTitle,
      description:
        'Whether the challenge is on, at which thresholds, and whether the providers behind it answer.',
      rows: <CaptchaStatusSummary status={captcha} copy={dict.security.blocks} />,
    },
    {
      key: 'bans',
      title: 'Banned addresses',
      description:
        'Host-level IP bans applied by fail2ban at the proxy. These are a different layer from the login lockouts below, which the web servers count per account and address.',
      state: banned.agentReported ? undefined : (
        <InlineAlert tone="warning" density="compact" announce="polite">
          The host security agent has not reported state yet, so no live ban is listed. An unban queued
          below is applied when the agent next runs.
        </InlineAlert>
      ),
      rows: (
        <>
          <BannedAddressList bans={banned.bans} />
          <QueueUnbanForm jailNames={banned.jailNames} />
        </>
      ),
      empty: (
        <>
          <p className="text-sm text-muted-foreground">No banned address is reported.</p>
          <QueueUnbanForm jailNames={banned.jailNames} />
        </>
      ),
    },
    {
      key: 'exemptions',
      title: 'Permanent exemptions',
      description:
        'A standing lift: the chosen account or address is never locked out or challenged until it is revoked. This is a login-layer exemption, separate from the host bans fail2ban applies.',
      rows: <ExemptionsPanel exemptions={exemptions} />,
      empty: (
        <>
          <p className="text-sm text-muted-foreground">No permanent exemption is active.</p>
          <ExemptionsPanel exemptions={[]} />
        </>
      ),
    },
    {
      key: 'activity',
      title: 'Login activity',
      description:
        'Live failure counters from the shared store: every failed sign-in, the account and address it came from, when it last failed, and when that account last signed in. A counter clears whole when its window lapses; clearing lifts it now. Expand a row for the attempts behind it.',
      // A counter store that cannot be read is not an empty counter, so the failure takes the
      // section's state and the section has no empty meaning until the read succeeds.
      state: activity.ok ? undefined : (
        <InlineAlert tone="destructive" density="compact" announce="polite">
          {activity.error}
        </InlineAlert>
      ),
      rows: activity.ok ? <LoginActivityTable rows={activity.rows} labels={labels} /> : null,
      empty: activity.ok ? <p className="text-sm text-muted-foreground">No failed sign-in is being counted.</p> : undefined,
    },
    {
      key: 'lockouts',
      title: 'Login lockouts',
      description:
        'The captcha hard limit: after repeated failed passwords the contest and admin web servers refuse the account and address for the lockout window. Lifting one clears the counter and closes the record.',
      rows: <LockoutList lockouts={lockouts} />,
      empty: <p className="text-sm text-muted-foreground">No open lockout.</p>,
    },
  ];

  return (
    <BoardPage
      // The module shell above renders the title, the description and the trail.
      ownsHeader={false}
      breadcrumbs={[]}
      title={dict.navigation.security.blocks.label}
      description={dict.navigation.security.blocks.description}
      sections={sections}
    />
  );
}
