import { clearRankingLockout, getRankingLockouts } from '@/app/actions/rankingLockouts';
import { Stack } from '@/components/core/Layout';
import { CaptchaStatusCard } from '@/components/ranking/CaptchaStatusCard';
import { LockoutCountersCard } from '@/components/ranking/LockoutCountersCard';
import { LockoutHistoryCard } from '@/components/ranking/LockoutHistoryCard';
import { getDictionary } from '@/i18n';
import { readCaptchaStatus } from '@/lib/captcha-status';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

export default async function RankingLockoutsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const [{ locale }, effective] = await Promise.all([
    params,
    authorizeRoutePage('ranking.lockouts'),
  ]);
  const copy = (await getDictionary(locale)).ranking.lockouts;
  // The read key guards the call too: the action enforces it and an unguarded call throws.
  if (!effective.has('lockout:read')) {
    return <Stack gap={6} />;
  }
  const state = await getRankingLockouts();
  const captcha = await readCaptchaStatus(state.counters.ok);
  const canClear = effective.has('lockout:unlock');
  return (
    <Stack gap={6}>
      <LockoutCountersCard
        counters={state.counters}
        canClear={canClear}
        copy={copy}
        clearAction={clearRankingLockout}
      />
      <LockoutHistoryCard history={state.history} copy={copy} />
      <CaptchaStatusCard status={captcha} copy={copy} />
    </Stack>
  );
}
