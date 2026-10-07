import { getContests } from '@/app/actions/contests';
import { getTasks } from '@/app/actions/tasks';
import { getTeams } from '@/app/actions/teams';
import { apiClient, type ApiResponse } from '@/lib/apiClient';
import { buildRoute } from '@/lib/navigation/routes';
import { MAX_RESULTS_PER_ENTITY } from './search-scheduler';
import { filterTeams, isNumericQuery, type NavVisibility } from './palette-data';

export interface EntityHit {
  key: string;
  label: string;
  detail?: string;
  path: string;
}

export type EntitySearcher = (query: string, signal: AbortSignal) => Promise<EntityHit[]>;

interface UsersPageResponse {
  users?: Array<{
    id: number;
    username: string;
    first_name: string | null;
    last_name: string | null;
  }>;
}

function buildContestSearcher(locale: string): EntitySearcher {
  return async (query, signal) => {
    const data = await getContests({ page: 1, search: query });
    if (signal.aborted) return [];
    return data.contests.slice(0, MAX_RESULTS_PER_ENTITY).map((contest: Awaited<ReturnType<typeof getContests>>['contests'][number]) => ({
      key: `contest-${contest.id}`,
      label: contest.name,
      detail: `Contest #${contest.id}`,
      path: buildRoute(locale, 'contests.record', { id: contest.id }),
    }));
  };
}

function buildTaskSearcher(locale: string): EntitySearcher {
  return async (query, signal) => {
    const data = await getTasks({ page: 1, search: query });
    if (signal.aborted) return [];
    return data.tasks.slice(0, MAX_RESULTS_PER_ENTITY).map((task) => ({
      key: `task-${task.id}`,
      label: task.title || task.name,
      detail: `Task #${task.id}`,
      path: buildRoute(locale, 'tasks.record', { id: task.id }),
    }));
  };
}

function buildUserSearcher(locale: string): EntitySearcher {
  return async (query, signal) => {
    const params = new URLSearchParams({ search: query, perPage: String(MAX_RESULTS_PER_ENTITY), page: '1' });
    const result = await apiClient.get(`/api/users?${params.toString()}`, { signal });
    if (!result.success || signal.aborted) return [];
    const payload = result as ApiResponse & UsersPageResponse;
    return (payload.users ?? []).map((user) => ({
      key: `user-${user.id}`,
      label: user.username,
      detail: [user.first_name, user.last_name].filter(Boolean).join(' ') || `User #${user.id}`,
      path: buildRoute(locale, 'people.user-record', { id: user.id }),
    }));
  };
}

function buildTeamSearcher(locale: string): EntitySearcher {
  return async (query, signal) => {
    const teams = await getTeams();
    if (signal.aborted) return [];
    const matches = filterTeams(teams, query).slice(0, MAX_RESULTS_PER_ENTITY);
    return matches.map((team) => ({
      key: `team-${team.id}`,
      label: team.name,
      detail: team.code,
      path: buildRoute(locale, 'people.team-record', { id: team.id }),
    }));
  };
}

function buildSubmissionSearcher(locale: string): EntitySearcher {
  return async (query, signal) => {
    const trimmed = query.trim();
    if (!isNumericQuery(trimmed) || signal.aborted) return [];
    return [
      {
        key: `submission-${trimmed}`,
        label: `Submission #${trimmed}`,
        detail: 'Open submission record',
        path: buildRoute(locale, 'evaluation.submission-tabs.summary', { id: Number(trimmed) }),
      },
    ];
  };
}

export function buildEntitySearchers(visibility: NavVisibility, locale: string): EntitySearcher[] {
  const searchers: EntitySearcher[] = [];
  if (visibility.contests) searchers.push(buildContestSearcher(locale), buildSubmissionSearcher(locale));
  if (visibility.tasks) searchers.push(buildTaskSearcher(locale));
  if (visibility.users) searchers.push(buildUserSearcher(locale), buildTeamSearcher(locale));
  return searchers;
}
