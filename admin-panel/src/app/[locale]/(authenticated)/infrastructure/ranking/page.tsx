import { RankingClient } from '@/components/ranking/RankingClient';
import { getRankingAppearance, submitRankingAppearance } from '@/app/actions/rankingAppearance';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

/**
 * Why the appearance form is a plain server form: it must work before hydration and it
 * writes one row, so a client component would buy state the page does not need.
 */
export default async function InfrastructureRankingPage(): Promise<React.JSX.Element> {
  const effective = await authorizeRoutePage('infrastructure.ranking');
  const appearance = await getRankingAppearance();
  const canEdit = effective.has("ranking:appearance");
  return (
    <div className="space-y-6">
      {canEdit ? (
        <form action={submitRankingAppearance} className="space-y-4 rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
          <h2 className="text-lg font-semibold text-white">Scoreboard appearance</h2>
          <label className="block text-sm text-white/70">
            Title
            <input name="title" defaultValue={appearance.title} className="mt-1 w-full rounded-xl border border-white/5 bg-black/40 px-3 py-2 text-white" />
          </label>
          <label className="block text-sm text-white/70">
            Subtitle
            <input name="subtitle" defaultValue={appearance.subtitle} className="mt-1 w-full rounded-xl border border-white/5 bg-black/40 px-3 py-2 text-white" />
          </label>
          <label className="block text-sm text-white/70">
            Organisation
            <input name="organisation" defaultValue={appearance.organisation} className="mt-1 w-full rounded-xl border border-white/5 bg-black/40 px-3 py-2 text-white" />
          </label>
          <label className="block text-sm text-white/70">
            Access
            <select name="accessMode" defaultValue={appearance.accessMode} className="mt-1 w-full rounded-xl border border-white/5 bg-black/40 px-3 py-2 text-white">
              <option value="public">Public</option>
              <option value="protected">Sign-in required</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-white/70">
            <input type="checkbox" name="showIdColumn" defaultChecked={appearance.showIdColumn} />
            Show the id column
          </label>
          <label className="block text-sm text-white/70">
            Footer text
            <input name="footerText" defaultValue={appearance.footerText} className="mt-1 w-full rounded-xl border border-white/5 bg-black/40 px-3 py-2 text-white" />
          </label>
          <label className="block text-sm text-white/70">
            Credits text
            <input name="creditsText" defaultValue={appearance.creditsText} className="mt-1 w-full rounded-xl border border-white/5 bg-black/40 px-3 py-2 text-white" />
          </label>
          <button type="submit" className="rounded-xl bg-indigo-500/20 px-4 py-2 text-indigo-300">Save appearance</button>
        </form>
      ) : null}
      <RankingClient permissionKeys={[...effective]} />
    </div>
  );
}

