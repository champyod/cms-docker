import type { Prisma } from '@prisma/client';
import { filterReadableFields } from '@/lib/field-permissions';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/server/authorization';
import { toIsoDate } from '@/lib/queries/read-model-format';
import { readContestEditData, type ContestEditData } from '@/lib/queries/contest-edit';

export type ContestDetailSummary = {
  id: number; name: string; description: string; is_active: boolean;
  start: string | null; stop: string | null; analysis_start: string | null; analysis_stop: string | null;
  permissionKeys: readonly string[];
};

export type ContestOverviewData = { contest: ContestDetailSummary; permissionKeys: readonly string[] };

export type ContestTaskRow = { id: number; name: string; title: string; num: number | null };

export type ContestTasksData = {
  contestId: number; tasks: readonly ContestTaskRow[]; availableTasks: readonly ContestTaskRow[];
  permissionKeys: readonly string[];
};

export type ContestParticipantRow = {
  id: number; user_id: number; hidden: boolean; unrestricted: boolean;
  user: { username: string; first_name: string; last_name: string } | null;
  team: { code: string } | null;
};

export type ContestParticipantsData = {
  contestId: number; participations: readonly ContestParticipantRow[];
  availableUsers: readonly { id: number; username: string; first_name: string; last_name: string }[];
  teams: readonly { id: number; code: string; name: string }[]; permissionKeys: readonly string[];
};

export type ContestSettingsFields = {
  name: string; description: string; timezone: string | null; allow_questions: boolean; allow_user_tests: boolean;
  submissions_download_allowed: boolean; allow_password_authentication: boolean;
  allow_registration: boolean; analysis_enabled: boolean; token_mode: string;
  score_precision: number; start: string | null; stop: string | null; analysis_start: string | null; analysis_stop: string | null;
};

export type ContestSettingsData = { contestId: number; fields: ContestSettingsFields; permissionKeys: readonly string[] };

type ParticipationEntry = {
  id: number; user_id: number; hidden: boolean; unrestricted: boolean;
  users: { username: string; first_name: string; last_name: string } | null; teams?: { code: string } | null;
};

const contestSummarySelect = {
  id: true, name: true, description: true, is_active: true, start: true, stop: true, analysis_start: true, analysis_stop: true,
} satisfies Prisma.contestsSelect;

// Why: all summary fields share the contest:read gate; row fallbacks only satisfy Partial types.
function toContestSummary(row: Prisma.contestsGetPayload<{ select: typeof contestSummarySelect }>, permissions: ReadonlySet<string>): ContestDetailSummary {
  const visible = filterReadableFields('contests', row, permissions);
  return {
    id: visible.id ?? row.id, name: visible.name ?? row.name, description: visible.description ?? row.description,
    is_active: visible.is_active ?? row.is_active, start: toIsoDate(row.start), stop: toIsoDate(row.stop),
    analysis_start: toIsoDate(row.analysis_start), analysis_stop: toIsoDate(row.analysis_stop),
    permissionKeys: [...permissions],
  };
}

export async function getContestDetailSummary(contestId: number): Promise<ContestDetailSummary | null> {
  const permissions = await requirePermission('contest:read');
  const row = await prisma.contests.findUnique({ where: { id: contestId }, select: contestSummarySelect });
  if (!row) return null;
  return toContestSummary(row, permissions);
}

export async function getContestOverview(contestId: number): Promise<ContestOverviewData | null> {
  const contest = await getContestDetailSummary(contestId);
  if (!contest) return null;
  return { contest, permissionKeys: contest.permissionKeys };
}

function toContestTaskRow(row: { id: number; name: string; title: string; num: number | null }, permissions: ReadonlySet<string>): ContestTaskRow {
  const visible = filterReadableFields('tasks', row, permissions);
  return { id: visible.id ?? row.id, name: visible.name ?? row.name, title: visible.title ?? row.title, num: visible.num ?? row.num };
}

export async function getContestTasks(contestId: number): Promise<ContestTasksData | null> {
  const permissions = new Set<string>([...await requirePermission('contest:read'), ...await requirePermission('task:read')]);
  if (!await prisma.contests.findUnique({ where: { id: contestId }, select: { id: true } })) return null;
  const taskSelect = { id: true, name: true, title: true, num: true };
  const tasks = await prisma.tasks.findMany({ where: { contest_id: contestId }, select: taskSelect, orderBy: { num: 'asc' } });
  // Why: link candidates are unassigned tasks, listed only with task:update (not just task:read).
  const canAssign = hasEffectivePermission(permissions, 'task:update');
  const availableTasks = canAssign
    ? await prisma.tasks.findMany({ where: { contest_id: null }, select: taskSelect, orderBy: { name: 'asc' } })
    : [];
  return {
    contestId, tasks: tasks.map((row) => toContestTaskRow(row, permissions)),
    availableTasks: availableTasks.map((row) => toContestTaskRow(row, permissions)), permissionKeys: [...permissions],
  };
}

function toParticipantRow(entry: ParticipationEntry, permissions: ReadonlySet<string>): ContestParticipantRow {
  const visible = filterReadableFields('participations', { id: entry.id, user_id: entry.user_id, hidden: entry.hidden, unrestricted: entry.unrestricted }, permissions);
  const showTeam = hasEffectivePermission(permissions, 'team:read');
  return {
    id: visible.id ?? entry.id, user_id: visible.user_id ?? entry.user_id, hidden: visible.hidden ?? entry.hidden,
    unrestricted: visible.unrestricted ?? entry.unrestricted,
    user: entry.users ? { username: entry.users.username, first_name: entry.users.first_name, last_name: entry.users.last_name } : null,
    team: showTeam && entry.teams ? { code: entry.teams.code } : null,
  };
}

export async function getContestParticipants(contestId: number): Promise<ContestParticipantsData | null> {
  const permissions = new Set<string>([...await requirePermission('contest:read'), ...await requirePermission('participation:read'), ...await requirePermission('user:read')]);
  if (!await prisma.contests.findUnique({ where: { id: contestId }, select: { id: true } })) return null;
  // Why: teams need their own team:read projection; users are covered by the user:read gate above.
  const baseSelect = { id: true, user_id: true, hidden: true, unrestricted: true, users: { select: { username: true, first_name: true, last_name: true } } };
  const participations = hasEffectivePermission(permissions, 'team:read')
    ? await prisma.participations.findMany({ where: { contest_id: contestId }, select: { ...baseSelect, teams: { select: { code: true } } }, orderBy: { id: 'asc' } })
    : await prisma.participations.findMany({ where: { contest_id: contestId }, select: baseSelect, orderBy: { id: 'asc' } });
  // Why: invite pickers need their read right plus participation:create — else empty, never partial.
  const canInviteUsers = hasEffectivePermission(permissions, 'participation:create');
  const canInviteTeams = canInviteUsers && hasEffectivePermission(permissions, 'team:read');
  const [availableUsers, teams] = await Promise.all([
    canInviteUsers ? prisma.users.findMany({ select: { id: true, username: true, first_name: true, last_name: true }, orderBy: { username: 'asc' } }) : Promise.resolve([]),
    canInviteTeams ? prisma.teams.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }) : Promise.resolve([]),
  ]);
  return {
    contestId, participations: participations.map((entry) => toParticipantRow(entry, permissions)),
    availableUsers, teams, permissionKeys: [...permissions],
  };
}

const contestSettingsSelect = {
  name: true, description: true, timezone: true, allow_questions: true, allow_user_tests: true,
  submissions_download_allowed: true, allow_password_authentication: true, allow_registration: true,
  analysis_enabled: true, token_mode: true, score_precision: true, start: true, stop: true,
  analysis_start: true, analysis_stop: true,
} satisfies Prisma.contestsSelect;

export async function getContestSettings(contestId: number): Promise<ContestSettingsData | null> {
  const permissions = await requirePermission('contest:read');
  const row = await prisma.contests.findUnique({ where: { id: contestId }, select: contestSettingsSelect });
  if (!row) return null;
  const visible = filterReadableFields('contests', row, permissions);
  const pick = <K extends keyof typeof row>(key: K): (typeof row)[K] => (visible[key] ?? row[key]) as (typeof row)[K];
  return {
    contestId,
    fields: {
      name: pick('name'), description: pick('description'), timezone: pick('timezone'),
      allow_questions: pick('allow_questions'), allow_user_tests: pick('allow_user_tests'),
      submissions_download_allowed: pick('submissions_download_allowed'),
      allow_password_authentication: pick('allow_password_authentication'),
      allow_registration: pick('allow_registration'), analysis_enabled: pick('analysis_enabled'),
      token_mode: String(pick('token_mode')), score_precision: pick('score_precision'),
      start: toIsoDate(row.start), stop: toIsoDate(row.stop),
      analysis_start: toIsoDate(row.analysis_start), analysis_stop: toIsoDate(row.analysis_stop),
    },
    permissionKeys: [...permissions],
  };
}

export async function getContestEditData(contestId: number): Promise<ContestEditData | null> {
  const permissions = new Set<string>([...await requirePermission('contest:read'), ...await requirePermission('contest:update')]);
  return readContestEditData(contestId, permissions);
}
