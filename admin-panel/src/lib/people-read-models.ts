import type { Prisma } from '@prisma/client';
import { filterReadableFieldsWith, getFieldAccess } from '@/lib/field-permissions';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { prisma } from '@/lib/prisma';
import { buildUserSearchWhere, safeUserSelect, submissionsListInclude, usersPageSelect, type SafeUser, type UsersPageRow } from '@/lib/prisma-selects';
import { requirePermission } from '@/lib/server/authorization';
import {
  collectHistory, toContestIdentity, toIso, toTeamIdentity, toTeamSummary, toUserIdentity, teamSummaryAccess,
  type ContestIdentity, type HistoryAccess, type ParticipationIntervalRow,
} from '@/lib/people-read-model-projections';
import type {
  SubmissionsPageResult, TeamContest, TeamMember, TeamSummary, TeamsPageResult, UserHistory,
  UserProfile, UserSummary, UserTeamMembership, UsersPageResult,
} from '@/lib/people-read-model-types';
import type { SubmissionListItem } from '@/types';

const USERS_PER_PAGE = 20;
const MAX_USERS_PER_PAGE = 100;
const SUBMISSIONS_PER_PAGE = 20;
const RECENT_ACTIVITY_LIMIT = 50;

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
  // Why no field projection: every column below is bound to user:read, the key this
  // reader already required, so an access table could not strip one. The team codes
  // are a nested teams.code, so they need participation:list and team:read as well.
  const canReadTeamCodes = hasEffectivePermission(permissions, 'participation:list') && hasEffectivePermission(permissions, 'team:read');
  return {
    id: row.id, username: row.username, firstName: row.first_name, lastName: row.last_name,
    status: row.status, organization: row.organization, country: row.country,
    participationCount: row._count.participations,
    teamCodes: canReadTeamCodes ? row.participations.map((entry) => entry.teams?.code).filter((code): code is string => typeof code === 'string') : [],
  };
}

export async function getUserProfile(userId: number): Promise<UserProfile | null> {
  await requirePermission('user:read');
  const row = await prisma.users.findUnique({ where: { id: userId }, select: { id: true, username: true, first_name: true, last_name: true, email: true, timezone: true, preferred_languages: true, status: true, organization: true, country: true } });
  if (!row) return null;
  // Why no field projection: every column below is bound to user:read, the key this
  // reader already required, so an access table could not strip one.
  return {
    id: row.id, username: row.username, firstName: row.first_name, lastName: row.last_name,
    email: row.email, timezone: row.timezone, preferredLanguages: [...row.preferred_languages],
    status: row.status, organization: row.organization, country: row.country,
  };
}

export async function getUserEditData(userId: number): Promise<SafeUser | null> {
  // Why no field projection: every column safeUserSelect names is gated on
  // user:read, the key this reader already required, so an access table could not
  // strip one, and the credential column is absent from the select by design.
  await requirePermission('user:read');
  return prisma.users.findUnique({ where: { id: userId }, select: safeUserSelect });
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
    const participation = filterReadableFieldsWith(access.participations, { contest_id: entry.contest_id, team_id: entry.team_id });
    const contest = toContestIdentity(entry.contests, access.contests);
    const team = toTeamIdentity(entry.teams, access.teams);
    return { id: entry.id, contestId: participation.contest_id ?? null, contestName: contest.name, teamId: participation.team_id ?? null, teamCode: team.code, teamName: team.name };
  });
}

export async function getUserHistory(userId: number): Promise<UserHistory | null> {
  const permissions = combinePermissions(await requirePermission('user:read'), await requirePermission('participation:list'), await requirePermission('submission:read'));
  const row = await prisma.users.findUnique({ where: { id: userId }, select: { last_login_at: true, participations: { orderBy: { contests: { start: 'desc' } }, select: { id: true, contest_id: true, team_id: true, starting_time: true, contests: { select: { id: true, name: true, start: true, stop: true } }, teams: { select: { id: true, code: true, name: true } }, submissions: { orderBy: { timestamp: 'desc' }, select: { id: true, timestamp: true, language: true, official: true, task_id: true, tasks: { select: { id: true, name: true } }, submission_results: { select: { score: true } } } } } } } });
  if (!row) return null;
  const access: HistoryAccess = {
    users: getFieldAccess('users', permissions),
    participations: getFieldAccess('participations', permissions),
    contests: getFieldAccess('contests', permissions),
    teams: getFieldAccess('teams', permissions),
    tasks: getFieldAccess('tasks', permissions),
    submissions: getFieldAccess('submissions', permissions),
    submission_results: getFieldAccess('submission_results', permissions),
  };
  const account = filterReadableFieldsWith(access.users, { last_login_at: row.last_login_at });
  // Why: skip the interval query for users without participations — nothing to join, no extra round trip.
  const intervals = row.participations.length > 0 ? await fetchParticipationIntervals(userId) : [];
  const lists = collectHistory(row.participations, intervals, access);
  return { accountAccess: { lastLoginAt: toIso(account.last_login_at) }, ...lists, recentContestActivity: lists.submissions.slice(0, RECENT_ACTIVITY_LIMIT) };
}

export async function getTeamSummary(teamId: number): Promise<TeamSummary | null> {
  const permissions = await requirePermission('team:read');
  const row = await prisma.teams.findUnique({ where: { id: teamId }, select: { id: true, code: true, name: true, organization: true, leader_id: true, leader: { select: { id: true, username: true, first_name: true, last_name: true } }, _count: { select: { participations: true } } } });
  if (!row) return null;
  return toTeamSummary(row, teamSummaryAccess(permissions));
}

export type TeamEditData = Pick<TeamSummary, 'id' | 'code' | 'name'>;

export async function getTeamEditData(teamId: number): Promise<TeamEditData | null> {
  const permissions = await requirePermission('team:read');
  const row = await prisma.teams.findUnique({ where: { id: teamId }, select: { id: true, code: true, name: true } });
  if (!row) return null;
  // Why the projection: TeamModal renders code and name as inputs, so a caller
  // who may not read one gets null rather than the stored value. Why id is not
  // projected: it is the record key this reader was asked for, also team:read.
  const visible = filterReadableFieldsWith(getFieldAccess('teams', permissions), row);
  return { id: row.id, code: visible.code ?? null, name: visible.name ?? null };
}

export async function getTeamMembers(teamId: number): Promise<readonly TeamMember[]> {
  const permissions = combinePermissions(await requirePermission('team:read'), await requirePermission('participation:list'), await requirePermission('user:read'));
  const access = {
    users: getFieldAccess('users', permissions),
    contests: getFieldAccess('contests', permissions),
  };
  const row = await prisma.teams.findUnique({ where: { id: teamId }, select: { id: true, participations: { select: { user_id: true, users: { select: { id: true, username: true, first_name: true, last_name: true } }, contests: { select: { id: true, name: true } } } } } });
  if (!row) return [];
  const members = new Map<number, TeamMember & { contests: ContestIdentity[] }>();
  // Why a per-member id Set: rescanning a member's own contests makes the walk
  // quadratic in that member's participations.
  const seenContestsByUser = new Map<number, Set<number>>();
  for (const entry of row.participations) {
    const contest = toContestIdentity(entry.contests, access.contests);
    const key = entry.user_id;
    const seenContests = seenContestsByUser.get(key) ?? new Set<number>();
    seenContestsByUser.set(key, seenContests);
    if (seenContests.has(entry.contests.id)) continue;
    seenContests.add(entry.contests.id);
    const existing = members.get(key);
    if (existing) {
      existing.contests.push(contest);
    } else {
      const user = toUserIdentity(entry.users, access.users);
      members.set(key, { userId: user.id, username: user.username, firstName: user.firstName, lastName: user.lastName, contests: [contest] });
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
    if (!contests.has(entry.contests.id)) contests.set(entry.contests.id, { id: visible.id ?? null, name: visible.name ?? null, description: visible.description ?? null, start: toIso(entry.contests.start), stop: toIso(entry.contests.stop) });
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
  const access = teamSummaryAccess(permissions);
  const rows = await prisma.teams.findMany({ select: { id: true, code: true, name: true, organization: true, leader_id: true, leader: { select: { id: true, username: true, first_name: true, last_name: true } }, _count: { select: { participations: true } } }, orderBy: { name: 'asc' } });
  return { teams: rows.map((row) => toTeamSummary(row, access)), effectivePermissions: permissions };
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
