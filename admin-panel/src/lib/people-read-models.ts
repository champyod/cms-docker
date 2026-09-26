import type { Prisma } from '@prisma/client';
import { filterReadableFields, filterReadableFieldsWith, getFieldAccess, type FieldAccess } from '@/lib/field-permissions';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { prisma } from '@/lib/prisma';
import { buildUserSearchWhere, submissionsListInclude, usersPageSelect, type UsersPageRow } from '@/lib/prisma-selects';
import { requirePermission } from '@/lib/server/authorization';
import type {
  SubmissionsPageResult, TeamContest, TeamMember, TeamSummary, TeamsPageResult, UserHistory,
  UserHistoryParticipation, UserHistorySubmission, UserProfile, UserSummary, UserTeamMembership, UsersPageResult,
} from '@/lib/people-read-model-types';
import type { SubmissionListItem } from '@/types';

const USERS_PER_PAGE = 20;
const MAX_USERS_PER_PAGE = 100;
const SUBMISSIONS_PER_PAGE = 20;
const RECENT_ACTIVITY_LIMIT = 50;

// Why: ISO strings serialize safely through server action boundaries (Prisma returns Dates).
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Why: delay/extra columns are Postgres intervals — clients receive plain seconds, never interval objects.
function toIntervalSeconds(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    const part = value as { days?: unknown; hours?: unknown; minutes?: unknown; seconds?: unknown };
    const num = (entry: unknown): number => (typeof entry === 'number' && Number.isFinite(entry) ? entry : 0);
    return num(part.days) * 86400 + num(part.hours) * 3600 + num(part.minutes) * 60 + num(part.seconds);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type ParticipationIntervalRow = { id: number; delay_time_seconds: number | null; extra_time_seconds: number | null };

// Why a single Set: spreading the returned sets into an array literal builds a
// throwaway array per gate before the Set is constructed.
// Why still sequential: each gate throws on its own key, so the first missing
// permission is the one the caller must be told about.
function combinePermissions(...granted: readonly ReadonlySet<string>[]): Set<string> {
  const permissions = new Set<string>();
  for (const set of granted) for (const key of set) permissions.add(key);
  return permissions;
}

// Why: Postgres interval columns are not selectable through the generated Prisma client,
// so participation delay/extra seconds arrive via typed raw SQL (same pattern as queryParticipationDetails).
async function fetchParticipationIntervals(userId: number): Promise<readonly ParticipationIntervalRow[]> {
  return prisma.$queryRaw<ParticipationIntervalRow[]>`SELECT id, EXTRACT(EPOCH FROM delay_time)::int AS delay_time_seconds, EXTRACT(EPOCH FROM extra_time)::int AS extra_time_seconds FROM participations WHERE user_id = ${userId}`;
}

export async function getUserSummary(userId: number): Promise<UserSummary | null> {
  const permissions = await requirePermission('user:read');
  const row = await prisma.users.findUnique({ where: { id: userId }, select: { id: true, username: true, first_name: true, last_name: true, status: true, organization: true, country: true, _count: { select: { participations: true } }, participations: { select: { teams: { select: { code: true } } } } } });
  if (!row) return null;
  const visible = filterReadableFields('users', { id: row.id, username: row.username, first_name: row.first_name, last_name: row.last_name, status: row.status, organization: row.organization, country: row.country }, permissions);
  return {
    id: visible.id ?? row.id, username: visible.username ?? row.username, firstName: visible.first_name ?? row.first_name, lastName: visible.last_name ?? row.last_name,
    status: visible.status ?? row.status, organization: visible.organization ?? row.organization, country: visible.country ?? row.country,
    participationCount: row._count.participations,
    teamCodes: row.participations.map((entry) => entry.teams?.code).filter((code): code is string => typeof code === 'string'),
  };
}

export async function getUserProfile(userId: number): Promise<UserProfile | null> {
  const permissions = await requirePermission('user:read');
  const row = await prisma.users.findUnique({ where: { id: userId }, select: { id: true, username: true, first_name: true, last_name: true, email: true, timezone: true, preferred_languages: true, status: true, organization: true, country: true } });
  if (!row) return null;
  const visible = filterReadableFields('users', { id: row.id, username: row.username, first_name: row.first_name, last_name: row.last_name, email: row.email, timezone: row.timezone, preferred_languages: row.preferred_languages, status: row.status, organization: row.organization, country: row.country }, permissions);
  return {
    id: visible.id ?? row.id, username: visible.username ?? row.username, firstName: visible.first_name ?? row.first_name, lastName: visible.last_name ?? row.last_name,
    email: visible.email ?? row.email, timezone: visible.timezone ?? row.timezone, preferredLanguages: [...(visible.preferred_languages ?? row.preferred_languages)],
    status: visible.status ?? row.status, organization: visible.organization ?? row.organization, country: visible.country ?? row.country,
  };
}

export async function getUserTeams(userId: number): Promise<readonly UserTeamMembership[]> {
  const permissions = combinePermissions(await requirePermission('user:read'), await requirePermission('participation:list'), await requirePermission('team:read'));
  // Why: one access table per entity, built before the map, so N rows resolve N rows of
  // fields instead of N full permission tables.
  const access = {
    participations: getFieldAccess('participations', permissions),
    contests: getFieldAccess('contests', permissions),
    teams: getFieldAccess('teams', permissions),
  };
  const rows = await prisma.participations.findMany({ where: { user_id: userId }, select: { id: true, contest_id: true, team_id: true, contests: { select: { id: true, name: true } }, teams: { select: { id: true, code: true, name: true } } }, orderBy: { id: 'asc' } });
  return rows.map((entry) => {
    const participation = filterReadableFieldsWith(access.participations, { id: entry.id, contest_id: entry.contest_id, team_id: entry.team_id });
    const contest = filterReadableFieldsWith(access.contests, { id: entry.contests.id, name: entry.contests.name });
    const team = entry.teams ? filterReadableFieldsWith(access.teams, { id: entry.teams.id, code: entry.teams.code, name: entry.teams.name }) : {};
    return { id: participation.id ?? entry.id, contestId: participation.contest_id ?? entry.contest_id, contestName: contest.name ?? entry.contests.name, teamId: participation.team_id ?? entry.team_id, teamCode: team.code ?? entry.teams?.code ?? null, teamName: team.name ?? entry.teams?.name ?? null };
  });
}

type HistorySubmissionRow = { id: number; timestamp: Date; language: string | null; official: boolean; task_id: number; tasks: { id: number; name: string } | null; submission_results: Array<{ score: number | null }> };

type HistoryAccess = { submissions: Record<string, FieldAccess>; submission_results: Record<string, FieldAccess> };

// Why: one shared mapper so the full list and the capped activity feed stay identical.
function toHistorySubmission(submission: HistorySubmissionRow, contestId: number | null, contestName: string | null, access: HistoryAccess): UserHistorySubmission {
  const visible = filterReadableFieldsWith(access.submissions, { id: submission.id, language: submission.language, official: submission.official });
  const scoreRow = submission.submission_results[0] ?? null;
  const scoreVisible = scoreRow ? filterReadableFieldsWith(access.submission_results, { score: scoreRow.score }) : {};
  return { id: visible.id ?? submission.id, contestId, contestName, taskId: submission.task_id, taskName: submission.tasks?.name ?? null, timestamp: toIso(submission.timestamp) ?? '', language: visible.language ?? submission.language, official: visible.official ?? submission.official, score: scoreVisible.score ?? scoreRow?.score ?? null };
}

export async function getUserHistory(userId: number): Promise<UserHistory | null> {
  const permissions = combinePermissions(await requirePermission('user:read'), await requirePermission('participation:list'), await requirePermission('submission:read'));
  const row = await prisma.users.findUnique({ where: { id: userId }, select: { last_login_at: true, participations: { orderBy: { contests: { start: 'desc' } }, select: { id: true, contest_id: true, team_id: true, starting_time: true, contests: { select: { id: true, name: true, start: true, stop: true } }, teams: { select: { id: true, code: true, name: true } }, submissions: { orderBy: { timestamp: 'desc' }, select: { id: true, timestamp: true, language: true, official: true, task_id: true, tasks: { select: { id: true, name: true } }, submission_results: { select: { score: true } } } } } } } });
  if (!row) return null;
  const access: HistoryAccess & { users: Record<string, FieldAccess>; participations: Record<string, FieldAccess>; contests: Record<string, FieldAccess>; teams: Record<string, FieldAccess> } = {
    users: getFieldAccess('users', permissions),
    participations: getFieldAccess('participations', permissions),
    contests: getFieldAccess('contests', permissions),
    teams: getFieldAccess('teams', permissions),
    submissions: getFieldAccess('submissions', permissions),
    submission_results: getFieldAccess('submission_results', permissions),
  };
  const account = filterReadableFieldsWith(access.users, { last_login_at: row.last_login_at });
  // Why: skip the interval query for users without participations — nothing to join, no extra round trip.
  const intervals = row.participations.length > 0 ? await fetchParticipationIntervals(userId) : [];
  const intervalById = new Map(intervals.map((item) => [item.id, item]));
  const participations: UserHistoryParticipation[] = [];
  const contests: Array<{ id: number | null; name: string | null; start: string | null; stop: string | null }> = [];
  const seenContestIds = new Set<number>();
  const teams: Array<{ id: number | null; code: string | null; name: string | null }> = [];
  const seenTeamIds = new Set<number>();
  const submissions: UserHistorySubmission[] = [];
  for (const entry of row.participations) {
    const participation = filterReadableFieldsWith(access.participations, { id: entry.id, contest_id: entry.contest_id, team_id: entry.team_id, starting_time: entry.starting_time });
    const contest = entry.contests ? filterReadableFieldsWith(access.contests, { id: entry.contests.id, name: entry.contests.name }) : {};
    const team = entry.teams ? filterReadableFieldsWith(access.teams, { id: entry.teams.id, code: entry.teams.code, name: entry.teams.name }) : {};
    participations.push({ id: participation.id ?? entry.id, contestId: participation.contest_id ?? entry.contest_id, contestName: contest.name ?? entry.contests?.name ?? null, contestStart: toIso(entry.contests?.start), contestStop: toIso(entry.contests?.stop), teamId: participation.team_id ?? entry.team_id, teamCode: team.code ?? entry.teams?.code ?? null, startingTime: toIso(entry.starting_time), delayTimeSeconds: toIntervalSeconds(intervalById.get(entry.id)?.delay_time_seconds ?? null), extraTimeSeconds: toIntervalSeconds(intervalById.get(entry.id)?.extra_time_seconds ?? null) });
    // Why an id Set: rescanning the accumulated lists makes the walk quadratic in
    // participations, and the first row for a contest or team is the one kept.
    if (entry.contests && !seenContestIds.has(entry.contests.id)) { seenContestIds.add(entry.contests.id); contests.push({ id: contest.id ?? entry.contests.id, name: contest.name ?? entry.contests.name, start: toIso(entry.contests.start), stop: toIso(entry.contests.stop) }); }
    if (entry.teams && !seenTeamIds.has(entry.teams.id)) { seenTeamIds.add(entry.teams.id); teams.push({ id: team.id ?? entry.teams.id, code: team.code ?? entry.teams.code, name: team.name ?? entry.teams.name }); }
    for (const submission of entry.submissions) submissions.push(toHistorySubmission(submission, entry.contest_id, entry.contests?.name ?? null, access));
  }
  submissions.sort((first, second) => (first.timestamp < second.timestamp ? 1 : -1));
  return { accountAccess: { lastLoginAt: toIso(account.last_login_at) }, participations, contests, teams, submissions, recentContestActivity: submissions.slice(0, RECENT_ACTIVITY_LIMIT) };
}

export async function getTeamSummary(teamId: number): Promise<TeamSummary | null> {
  const permissions = await requirePermission('team:read');
  const row = await prisma.teams.findUnique({ where: { id: teamId }, select: { id: true, code: true, name: true, organization: true, leader_id: true, leader: { select: { id: true, username: true, first_name: true, last_name: true } }, _count: { select: { participations: true } } } });
  if (!row) return null;
  const visible = filterReadableFields('teams', { id: row.id, code: row.code, name: row.name, organization: row.organization, leader_id: row.leader_id }, permissions);
  const leaderVisible = row.leader ? filterReadableFields('users', { id: row.leader.id, username: row.leader.username, first_name: row.leader.first_name, last_name: row.leader.last_name }, permissions) : null;
  return {
    id: visible.id ?? row.id, code: visible.code ?? row.code, name: visible.name ?? row.name, organization: visible.organization ?? row.organization,
    leaderId: visible.leader_id ?? row.leader_id, leader: row.leader ? { id: leaderVisible?.id ?? row.leader.id, username: leaderVisible?.username ?? row.leader.username, firstName: leaderVisible?.first_name ?? row.leader.first_name, lastName: leaderVisible?.last_name ?? row.leader.last_name } : null,
    participationCount: row._count.participations,
  };
}

export async function getTeamMembers(teamId: number): Promise<readonly TeamMember[]> {
  const permissions = combinePermissions(await requirePermission('team:read'), await requirePermission('participation:list'), await requirePermission('user:read'));
  const access = {
    users: getFieldAccess('users', permissions),
    contests: getFieldAccess('contests', permissions),
  };
  const row = await prisma.teams.findUnique({ where: { id: teamId }, select: { id: true, participations: { select: { user_id: true, users: { select: { id: true, username: true, first_name: true, last_name: true } }, contests: { select: { id: true, name: true } } } } } });
  if (!row) return [];
  const members = new Map<number, TeamMember & { contests: Array<{ id: number; name: string }> }>();
  // Why a per-member id Set: rescanning a member's own contests makes the walk
  // quadratic in that member's participations.
  const seenContestsByUser = new Map<number, Set<number>>();
  for (const entry of row.participations) {
    const user = entry.users ? filterReadableFieldsWith(access.users, { id: entry.users.id, username: entry.users.username, first_name: entry.users.first_name, last_name: entry.users.last_name }) : {};
    const contest = filterReadableFieldsWith(access.contests, { id: entry.contests.id, name: entry.contests.name });
    const key = entry.user_id;
    const seenContests = seenContestsByUser.get(key) ?? new Set<number>();
    seenContestsByUser.set(key, seenContests);
    if (seenContests.has(entry.contests.id)) continue;
    seenContests.add(entry.contests.id);
    const existing = members.get(key);
    const contestRef = { id: contest.id ?? entry.contests.id, name: contest.name ?? entry.contests.name };
    if (existing) {
      existing.contests.push(contestRef);
    } else {
      members.set(key, { userId: user.id ?? entry.users?.id ?? null, username: user.username ?? entry.users?.username ?? null, firstName: user.first_name ?? entry.users?.first_name ?? null, lastName: user.last_name ?? entry.users?.last_name ?? null, contests: [contestRef] });
    }
  }
  return [...members.values()];
}

export async function getTeamContests(teamId: number): Promise<readonly TeamContest[]> {
  const permissions = combinePermissions(await requirePermission('team:read'), await requirePermission('participation:list'), await requirePermission('contest:read'));
  const contestsAccess = getFieldAccess('contests', permissions);
  const row = await prisma.teams.findUnique({ where: { id: teamId }, select: { id: true, participations: { select: { contests: { select: { id: true, name: true, description: true, start: true, stop: true } } } } } });
  if (!row) return [];
  const contests = new Map<number, TeamContest>();
  for (const entry of row.participations) {
    const visible = filterReadableFieldsWith(contestsAccess, { id: entry.contests.id, name: entry.contests.name, description: entry.contests.description });
    if (!contests.has(entry.contests.id)) contests.set(entry.contests.id, { id: visible.id ?? entry.contests.id, name: visible.name ?? entry.contests.name, description: visible.description ?? entry.contests.description, start: toIso(entry.contests.start), stop: toIso(entry.contests.stop) });
  }
  return [...contests.values()];
}

export async function getUsers(input: { page: number; search: string; perPage: number }): Promise<UsersPageResult> {
  const permissions = await requirePermission('user:list');
  const safePerPage = Math.min(Math.max(Number(input.perPage) || USERS_PER_PAGE, 1), MAX_USERS_PER_PAGE);
  const safePage = Math.max(Number(input.page) || 1, 1);
  const where = buildUserSearchWhere(input.search);
  const [rows, total] = await Promise.all([
    prisma.users.findMany({ where, skip: (safePage - 1) * safePerPage, take: safePerPage, orderBy: { id: 'asc' }, select: usersPageSelect }),
    prisma.users.count({ where }),
  ]);
  const usersAccess = getFieldAccess('users', permissions);
  const users = rows.map((row) => filterReadableFieldsWith(usersAccess, row) as unknown as UsersPageRow);
  return { users, totalPages: Math.max(Math.ceil(total / safePerPage), 1), currentPage: safePage, perPage: safePerPage, total, effectivePermissions: permissions };
}

export async function getTeams(): Promise<TeamsPageResult> {
  const permissions = await requirePermission('team:list');
  const access = {
    teams: getFieldAccess('teams', permissions),
    users: getFieldAccess('users', permissions),
  };
  const rows = await prisma.teams.findMany({ select: { id: true, code: true, name: true, organization: true, leader_id: true, leader: { select: { id: true, username: true, first_name: true, last_name: true } }, _count: { select: { participations: true } } }, orderBy: { name: 'asc' } });
  const teams: TeamSummary[] = rows.map((row) => {
    const visible = filterReadableFieldsWith(access.teams, { id: row.id, code: row.code, name: row.name, organization: row.organization, leader_id: row.leader_id });
    const leaderVisible = row.leader ? filterReadableFieldsWith(access.users, { id: row.leader.id, username: row.leader.username, first_name: row.leader.first_name, last_name: row.leader.last_name }) : null;
    return { id: visible.id ?? row.id, code: visible.code ?? row.code, name: visible.name ?? row.name, organization: visible.organization ?? row.organization, leaderId: visible.leader_id ?? row.leader_id, leader: row.leader ? { id: leaderVisible?.id ?? row.leader.id, username: leaderVisible?.username ?? row.leader.username, firstName: leaderVisible?.first_name ?? row.leader.first_name, lastName: leaderVisible?.last_name ?? row.leader.last_name } : null, participationCount: row._count.participations };
  });
  return { teams, effectivePermissions: permissions };
}

export async function getSubmissions(input: { page: number; contestId?: number; taskId?: number; userId?: number }): Promise<SubmissionsPageResult> {
  const permissions = await requirePermission('submission:list');
  const safePage = Math.max(Number(input.page) || 1, 1);
  const participations: Record<string, number> = { ...(input.contestId ? { contest_id: input.contestId } : {}), ...(input.userId ? { user_id: input.userId } : {}) };
  const where: Prisma.submissionsWhereInput = { ...(input.taskId ? { task_id: input.taskId } : {}), ...(Object.keys(participations).length > 0 ? { participations: participations as Prisma.submissionsWhereInput['participations'] } : {}) };
  const [rows, total] = await Promise.all([
    prisma.submissions.findMany({ where, skip: (safePage - 1) * SUBMISSIONS_PER_PAGE, take: SUBMISSIONS_PER_PAGE, orderBy: { timestamp: 'desc' }, include: submissionsListInclude }),
    prisma.submissions.count({ where }),
  ]);
  // Why: relation rows the caller may not read are withheld while the list row keeps its shape.
  const canSeeResults = hasEffectivePermission(permissions, 'submissionresult:read');
  const canSeeFiles = hasEffectivePermission(permissions, 'file:read');
  const resultsAccess = getFieldAccess('submission_results', permissions);
  const filesAccess = getFieldAccess('files', permissions);
  const submissions = rows.map((row) => ({ ...row, submission_results: canSeeResults ? row.submission_results.map((result) => filterReadableFieldsWith(resultsAccess, result)) : [], files: canSeeFiles ? row.files.map((file) => filterReadableFieldsWith(filesAccess, file)) : [] })) as unknown as SubmissionListItem[];
  return { submissions, totalPages: Math.ceil(total / SUBMISSIONS_PER_PAGE), total, effectivePermissions: permissions };
}
