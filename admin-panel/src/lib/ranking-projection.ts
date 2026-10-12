import { prisma } from '@/lib/prisma';
import { readConfigTomlContestId } from '@/lib/deploy-config';

/**
 * Encodes an entity id the way ProxyService.encode_id does before it reaches the
 * ranking projection: every character outside [A-Za-z0-9] becomes `_<hex codepoint>`.
 * Kept here so a row written by the panel has the same key the proxy would push for
 * the same user or team.
 */
export function encodeId(entityId: string): string {
  let encoded = '';
  for (const character of entityId) {
    encoded += /[A-Za-z0-9]/.test(character)
      ? character
      : `_${character.codePointAt(0)!.toString(16)}`;
  }
  return encoded;
}

interface ProjectedUser {
  key: string;
  f_name: string;
  l_name: string;
  team: string | null;
}

/**
 * Mirrors ProxyService.initialize() for the ranked contest: re-pushes its non-hidden
 * participants into the ranking users projection and drops every other key, so a
 * participant added, edited or removed through the panel reaches the ranking without a
 * proxy reinitialize. Only the contest config.toml names active is touched, so editing
 * another contest's participations cannot empty the projection.
 *
 * Best-effort: a failure is logged rather than thrown, because the ranking service
 * unions the submission users and tolerates a stale projection, and a failed refresh
 * must not fail the change that triggered it.
 */
export async function resyncRankingUsers(contestId: number): Promise<void> {
  try {
    const activeContestId = await readConfigTomlContestId();
    if (activeContestId === null || activeContestId !== contestId) return;

    const participants = await prisma.participations.findMany({
      where: { contest_id: contestId, hidden: false },
      select: {
        users: { select: { username: true, first_name: true, last_name: true } },
        teams: { select: { code: true } },
      },
    });

    const rows: ProjectedUser[] = participants.map((participation) => ({
      key: encodeId(participation.users.username),
      f_name: participation.users.first_name,
      l_name: participation.users.last_name,
      team: participation.teams ? encodeId(participation.teams.code) : null,
    }));

    await prisma.$transaction([
      ...rows.map(
        (row) => prisma.$executeRaw`
          INSERT INTO ranking_users (key, f_name, l_name, team)
          VALUES (${row.key}, ${row.f_name}, ${row.l_name}, ${row.team})
          ON CONFLICT (key) DO UPDATE SET
            f_name = EXCLUDED.f_name,
            l_name = EXCLUDED.l_name,
            team = EXCLUDED.team,
            updated_at = CURRENT_TIMESTAMP
        `,
      ),
      prisma.$executeRaw`DELETE FROM ranking_users WHERE key <> ALL(${rows.map((row) => row.key)}::text[])`,
    ]);
  } catch (error) {
    console.error('Failed to resync the ranking users projection:', error);
  }
}

/** Resyncs whichever contest config.toml names active; for callers with no contest id. */
export async function resyncActiveRankingUsers(): Promise<void> {
  const activeContestId = await readConfigTomlContestId();
  if (activeContestId === null) return;
  await resyncRankingUsers(activeContestId);
}
