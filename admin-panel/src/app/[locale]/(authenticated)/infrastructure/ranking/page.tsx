import { RankingClient } from '@/components/ranking/RankingClient';
import { getRankingAppearance, submitRankingAppearance } from '@/app/actions/rankingAppearance';
import { clearRankingLockout, getRankingLockouts } from '@/app/actions/rankingLockouts';
import { endRankingOverride, getRankingOverrides, saveRankingOverride } from '@/app/actions/rankingOverrides';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

const FIELD_CLASS = 'mt-1 w-full rounded-xl border border-white/5 bg-black/40 px-3 py-2 text-white';
const CARD_CLASS = 'space-y-4 rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl';
const LABEL_CLASS = 'block text-sm text-white/70';

/**
 * Why the appearance and override forms are plain server forms: each writes one row and
 * must work before hydration, so a client component would buy state the page does not use.
 */
export default async function InfrastructureRankingPage(): Promise<React.JSX.Element> {
  const effective = await authorizeRoutePage('infrastructure.ranking');
  const appearance = await getRankingAppearance();
  const overrides = await getRankingOverrides();
  const canEdit = effective.has("ranking:appearance");
  const canOverride = effective.has("ranking:override");
  // Guarded on the read key, not only the button: the action enforces it too, and an
  // unguarded call would throw for a contest manager who may not see lockouts at all.
  const canSeeLockouts = effective.has("lockout:read");
  const lockoutState = canSeeLockouts ? await getRankingLockouts() : null;
  const canClearLockouts = effective.has("lockout:unlock");
  return (
    <div className="space-y-6">
      {canEdit ? (
        <form action={submitRankingAppearance} className={CARD_CLASS}>
          <h2 className="text-lg font-semibold text-white">Scoreboard appearance</h2>
          <label className={LABEL_CLASS}>
            Title
            <input name="title" defaultValue={appearance.title} className={FIELD_CLASS} />
          </label>
          <label className={LABEL_CLASS}>
            Subtitle
            <input name="subtitle" defaultValue={appearance.subtitle} className={FIELD_CLASS} />
          </label>
          <label className={LABEL_CLASS}>
            Organisation
            <input name="organisation" defaultValue={appearance.organisation} className={FIELD_CLASS} />
          </label>
          <label className={LABEL_CLASS}>
            Access
            <select name="accessMode" defaultValue={appearance.accessMode} className={FIELD_CLASS}>
              <option value="public">Public</option>
              <option value="protected">Sign-in required</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-white/70">
            <input type="checkbox" name="showIdColumn" defaultChecked={appearance.showIdColumn} />
            Show the id column
          </label>
          <label className={LABEL_CLASS}>
            Footer text
            <input name="footerText" defaultValue={appearance.footerText} className={FIELD_CLASS} />
          </label>
          <label className={LABEL_CLASS}>
            Credits text
            <input name="creditsText" defaultValue={appearance.creditsText} className={FIELD_CLASS} />
          </label>
          <button type="submit" className="rounded-xl bg-indigo-500/20 px-4 py-2 text-indigo-300">
            Save appearance
          </button>
        </form>
      ) : null}

      <section className={CARD_CLASS}>
        <h2 className="text-lg font-semibold text-white">Manual ranking overrides</h2>
        <p className="text-sm text-white/60">
          A row here changes what the scoreboard shows without touching the contest data.
          Ending one keeps its history.
        </p>
        {canOverride ? (
          <form action={saveRankingOverride} className="grid gap-3 md:grid-cols-2">
            <label className={LABEL_CLASS}>
              Contest id
              <input name="contestId" inputMode="numeric" required className={FIELD_CLASS} />
            </label>
            <label className={LABEL_CLASS}>
              Target
              <select name="targetKind" className={FIELD_CLASS}>
                <option value="user">user</option>
                <option value="team">team</option>
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Target key
              <input name="targetKey" required className={FIELD_CLASS} />
            </label>
            <label className={LABEL_CLASS}>
              Action
              <select name="action" className={FIELD_CLASS}>
                <option value="hide">hide the row</option>
                <option value="guest">add a guest row</option>
                <option value="pin">pin a rank</option>
                <option value="rename">rename the display name</option>
                <option value="score">override the shown score</option>
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Value (rank, name or score)
              <input name="value" className={FIELD_CLASS} />
            </label>
            <label className={LABEL_CLASS}>
              Reason
              <input name="reason" required className={FIELD_CLASS} />
            </label>
            <button type="submit" className="rounded-xl bg-indigo-500/20 px-4 py-2 text-indigo-300">
              Add override
            </button>
          </form>
        ) : null}
        <ul className="divide-y divide-white/10 text-sm text-white/80">
          {overrides.map((override) => (
            <li key={override.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="font-mono text-white/60">{override.id}</span>
              <span>
                {override.action} {override.targetKind} {override.targetKey}
                {override.value === "" ? null : ` (${override.value})`}
              </span>
              <span className="text-white/50">contest {override.contestId}</span>
              <span className="text-white/50">{override.reason}</span>
              {canOverride ? (
                <form action={endRankingOverride} className="ml-auto flex items-center gap-2">
                  <input type="hidden" name="id" value={override.id} />
                  <input
                    name="reason"
                    required
                    placeholder="reason"
                    className="rounded-lg border border-white/5 bg-black/40 px-2 py-1 text-white"
                  />
                  <button type="submit" className="rounded-lg bg-red-500/20 px-3 py-1 text-red-300">
                    End
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {lockoutState === null ? null : (
        <section className={CARD_CLASS}>
          <h2 className="text-lg font-semibold text-white">Console lockouts</h2>
          {lockoutState.ok ? (
            <ul className="divide-y divide-white/10 text-sm text-white/80">
              {lockoutState.lockouts.map((lockout) => (
                <li key={lockout.key} className="flex flex-wrap items-center gap-3 py-2">
                  <span>{lockout.subject}</span>
                  <span className="text-white/50">{lockout.count} failures</span>
                  <span className="text-white/50">{lockout.retryAfterSeconds}s left</span>
                  {canClearLockouts ? (
                    <form action={clearRankingLockout} className="ml-auto flex items-center gap-2">
                      <input type="hidden" name="key" value={lockout.key} />
                      <input
                        name="reason"
                        required
                        placeholder="reason"
                        className="rounded-lg border border-white/5 bg-black/40 px-2 py-1 text-white"
                      />
                      <button type="submit" className="rounded-lg bg-amber-500/20 px-3 py-1 text-amber-300">
                        Clear
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

      <RankingClient permissionKeys={[...effective]} />
    </div>
  );
}

