import { clearRankingLockout, getRankingLockouts } from '@/app/actions/rankingLockouts';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

const CARD_CLASS = 'space-y-4 rounded-2xl border border-border bg-card p-6';

export default async function RankingLockoutsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const [{ locale }, effective] = await Promise.all([
    params,
    authorizeRoutePage('ranking.lockouts'),
  ]);
  const copy = (await getDictionary(locale)).ranking;
  // Guarded on the read key, not only the button: the action enforces it too, and an
  // unguarded call would throw for a contest manager who may not see lockouts at all.
  const canSeeLockouts = effective.has('lockout:read');
  const lockoutState = canSeeLockouts ? await getRankingLockouts() : null;
  const canClearLockouts = effective.has('lockout:unlock');
  return (
    <div className="space-y-6">
      {lockoutState === null ? null : (
        <section className={CARD_CLASS}>
          <h2 className="text-lg font-semibold text-foreground">{copy.lockouts.title}</h2>
          {lockoutState.ok ? (
            <ul className="divide-y divide-border text-sm text-foreground">
              {lockoutState.lockouts.map((lockout) => (
                <li key={lockout.key} className="flex flex-wrap items-center gap-3 py-2">
                  <span>{lockout.subject}</span>
                  <span className="text-muted-foreground">
                    {lockout.count} {copy.lockouts.failures}
                  </span>
                  <span className="text-muted-foreground">
                    {lockout.retryAfterSeconds}s {copy.lockouts.remaining}
                  </span>
                  {canClearLockouts ? (
                    <form action={clearRankingLockout} className="ml-auto flex items-center gap-2">
                      <input type="hidden" name="key" value={lockout.key} />
                      <input
                        name="reason"
                        required
                        placeholder={copy.overrides.reason}
                        className="rounded-lg border border-border bg-muted/40 px-2 py-1 text-foreground"
                      />
                      <button type="submit" className="rounded-lg bg-amber-500/20 px-3 py-1 text-amber-300">
                        {copy.lockouts.clear}
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-amber-300">{lockoutState.error}</p>
          )}
        </section>
      )}
    </div>
  );
}
