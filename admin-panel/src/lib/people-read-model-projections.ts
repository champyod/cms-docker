import { filterReadableFieldsWith, getFieldAccess, type FieldAccessTable } from '@/lib/field-permissions';
import type {
  TeamSummary, UserHistory, UserHistoryParticipation, UserHistorySubmission,
} from '@/lib/people-read-model-types';

// Why: a field the caller may not read becomes null here, never the raw column —
// the access table drops exactly what the field permission removed, so a
// `visible.X ?? row.X` fallback would hand back the value it just took away. The
// one exception is the id of a row a reader returns: a reader only ever discloses
// ids for rows its own `:list`/`:read` key already lets it enumerate, and that id
// addresses the row rather than describing it.

// Why: ISO strings serialize safely through server action boundaries (Prisma returns Dates).
export function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Why: delay/extra columns are Postgres intervals — clients receive plain seconds, never interval objects.
export function toIntervalSeconds(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    const part = value as { days?: unknown; hours?: unknown; minutes?: unknown; seconds?: unknown };
    const num = (entry: unknown): number => (typeof entry === 'number' && Number.isFinite(entry) ? entry : 0);
    return num(part.days) * 86400 + num(part.hours) * 3600 + num(part.minutes) * 60 + num(part.seconds);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type NamedRow = { id: number; name: string };
export type NamedContestRow = NamedRow & { start: Date | string; stop: Date | string };
export type TeamIdentityRow = { id: number; code: string; name: string };
export type UserIdentityRow = { id: number; username: string; first_name: string; last_name: string };
export type TeamIdentity = { id: number | null; code: string | null; name: string | null };
export type UserIdentity = { id: number | null; username: string | null; firstName: string | null; lastName: string | null };
export type ContestIdentity = { id: number | null; name: string | null };
export type TeamSummaryRow = { id: number; code: string; name: string; organization: string | null; leader_id: number | null; leader: UserIdentityRow | null; _count: { participations: number } };
export type TeamSummaryAccess = { teams: FieldAccessTable<'teams'>; users: FieldAccessTable<'users'> };

export function toContestIdentity(contest: NamedRow | null, access: FieldAccessTable<'contests'>): ContestIdentity {
  if (!contest) return { id: null, name: null };
  const visible = filterReadableFieldsWith(access, { id: contest.id, name: contest.name });
  return { id: visible.id ?? null, name: visible.name ?? null };
}

export function toContestRef(contest: NamedContestRow | null, access: FieldAccessTable<'contests'>): UserHistory['contests'][number] {
  if (!contest) return { id: null, name: null, start: null, stop: null };
  const visible = filterReadableFieldsWith(access, { id: contest.id, name: contest.name, start: contest.start, stop: contest.stop });
  return { id: visible.id ?? null, name: visible.name ?? null, start: toIso(visible.start ?? null), stop: toIso(visible.stop ?? null) };
}

export function toTeamIdentity(team: TeamIdentityRow | null, access: FieldAccessTable<'teams'>): TeamIdentity {
  if (!team) return { id: null, code: null, name: null };
  const visible = filterReadableFieldsWith(access, { id: team.id, code: team.code, name: team.name });
  return { id: visible.id ?? null, code: visible.code ?? null, name: visible.name ?? null };
}

export function toUserIdentity(user: UserIdentityRow | null, access: FieldAccessTable<'users'>): UserIdentity {
  if (!user) return { id: null, username: null, firstName: null, lastName: null };
  const visible = filterReadableFieldsWith(access, { id: user.id, username: user.username, first_name: user.first_name, last_name: user.last_name });
  return { id: visible.id ?? null, username: visible.username ?? null, firstName: visible.first_name ?? null, lastName: visible.last_name ?? null };
}

// Why one relation or nothing: the leader's four columns are all bound to user:read,
// so a caller without that key may read no part of the leader and gets null instead.
function toLeader(leader: UserIdentityRow | null, access: FieldAccessTable<'users'>): TeamSummary['leader'] {
  if (!leader) return null;
  const visible = filterReadableFieldsWith(access, { id: leader.id, username: leader.username, first_name: leader.first_name, last_name: leader.last_name });
  if (visible.id === undefined || visible.username === undefined || visible.first_name === undefined || visible.last_name === undefined) return null;
  return { id: visible.id, username: visible.username, firstName: visible.first_name, lastName: visible.last_name };
}

// Why one projection for both readers: the list reader requires team:list and the
// record reader team:read, so two copies of this mapping drifted into handing a
// team:list-only caller the columns only team:read governs.
export function toTeamSummary(row: TeamSummaryRow, access: TeamSummaryAccess): TeamSummary {
  const visible = filterReadableFieldsWith(access.teams, { code: row.code, name: row.name, organization: row.organization, leader_id: row.leader_id });
  return {
    id: row.id, code: visible.code ?? null, name: visible.name ?? null, organization: visible.organization ?? null,
    leaderId: visible.leader_id ?? null, leader: toLeader(row.leader, access.users), participationCount: row._count.participations,
  };
}

export function teamSummaryAccess(permissions: ReadonlySet<string>): TeamSummaryAccess {
  return { teams: getFieldAccess('teams', permissions), users: getFieldAccess('users', permissions) };
}

export type HistorySubmissionRow = { id: number; timestamp: Date; language: string | null; official: boolean; task_id: number; tasks: NamedRow | null; submission_results: Array<{ score: number | null }> };
export type HistoryParticipationRow = { id: number; contest_id: number; team_id: number | null; starting_time: Date | null; contests: NamedContestRow | null; teams: TeamIdentityRow | null; submissions: HistorySubmissionRow[] };
export type ParticipationIntervalRow = { id: number; delay_time_seconds: number | null; extra_time_seconds: number | null };

export type HistoryAccess = {
  users: FieldAccessTable<'users'>;
  participations: FieldAccessTable<'participations'>;
  contests: FieldAccessTable<'contests'>;
  teams: FieldAccessTable<'teams'>;
  tasks: FieldAccessTable<'tasks'>;
  submissions: FieldAccessTable<'submissions'>;
  submission_results: FieldAccessTable<'submission_results'>;
};

type HistoryLists = Pick<UserHistory, 'participations' | 'contests' | 'teams' | 'submissions'>;

// Why: one shared mapper so the full list and the capped activity feed stay identical.
function toHistorySubmission(submission: HistorySubmissionRow, contestId: number | null, contestName: string | null, access: HistoryAccess): UserHistorySubmission {
  const visible = filterReadableFieldsWith(access.submissions, { language: submission.language, official: submission.official });
  const task = filterReadableFieldsWith(access.tasks, { name: submission.tasks?.name });
  const scoreRow = submission.submission_results[0] ?? null;
  const score = scoreRow ? filterReadableFieldsWith(access.submission_results, { score: scoreRow.score }).score ?? null : null;
  return { id: submission.id, contestId, contestName, taskId: submission.task_id, taskName: task.name ?? null, timestamp: toIso(submission.timestamp) ?? '', language: visible.language ?? null, official: visible.official ?? null, score };
}

// Why an id Set: rescanning the accumulated lists makes the walk quadratic in
// participations, and the first row for a contest or team is the one kept.
export function collectHistory(entries: readonly HistoryParticipationRow[], intervals: readonly ParticipationIntervalRow[], access: HistoryAccess): HistoryLists {
  const intervalById = new Map(intervals.map((item) => [item.id, item]));
  const participations: UserHistoryParticipation[] = [];
  const contests: UserHistory['contests'][number][] = [];
  const teams: UserHistory['teams'][number][] = [];
  const seenContestIds = new Set<number>();
  const seenTeamIds = new Set<number>();
  const submissions: UserHistorySubmission[] = [];
  for (const entry of entries) {
    const raw = filterReadableFieldsWith(access.participations, { contest_id: entry.contest_id, team_id: entry.team_id, starting_time: entry.starting_time });
    const contest = toContestRef(entry.contests, access.contests);
    const team = toTeamIdentity(entry.teams, access.teams);
    const interval = intervalById.get(entry.id);
    participations.push({ id: entry.id, contestId: raw.contest_id ?? null, contestName: contest.name, contestStart: contest.start, contestStop: contest.stop, teamId: raw.team_id ?? null, teamCode: team.code, startingTime: toIso(raw.starting_time ?? null), delayTimeSeconds: toIntervalSeconds(interval?.delay_time_seconds ?? null), extraTimeSeconds: toIntervalSeconds(interval?.extra_time_seconds ?? null) });
    if (contest.id !== null && !seenContestIds.has(contest.id)) { seenContestIds.add(contest.id); contests.push(contest); }
    if (team.id !== null && !seenTeamIds.has(team.id)) { seenTeamIds.add(team.id); teams.push(team); }
    for (const submission of entry.submissions) submissions.push(toHistorySubmission(submission, raw.contest_id ?? null, contest.name, access));
  }
  submissions.sort((first, second) => (first.timestamp < second.timestamp ? 1 : -1));
  return { participations, contests, teams, submissions };
}
