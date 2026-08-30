import { apiError, apiSuccess, verifyApiPermission } from '@/lib/api-utils';
import { buildRankingAuthHeader, getRankingSession } from '@/lib/ranking-session';

/** Raw payloads proxied from the external CMS ranking service — schema-owned by that service, not us. */
type SnapshotPayload = {
  contests: unknown;
  tasks: unknown;
  teams: unknown;
  users: unknown;
  scores: Record<string, Record<string, number>>;
};

async function fetchJson(baseUrl: string, path: string, authHeader: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${path} (${res.status})`);
  }

  return res.json();
}

export async function GET() {
  const { authorized, response } = await verifyApiPermission('all');
  if (!authorized) return response;

  try {
    const session = await getRankingSession();
    if (!session) {
      return apiError({ status: 401, message: 'Ranking session not configured' });
    }

    const authHeader = buildRankingAuthHeader(session.username, session.password);

    const [contests, tasks, teams, users, scores] = await Promise.all([
      fetchJson(session.baseUrl, '/contests/', authHeader),
      fetchJson(session.baseUrl, '/tasks/', authHeader),
      fetchJson(session.baseUrl, '/teams/', authHeader),
      fetchJson(session.baseUrl, '/users/', authHeader),
      fetchJson(session.baseUrl, '/scores', authHeader),
    ]);

    const payload: SnapshotPayload = {
      contests,
      tasks,
      teams,
      users,
      scores,
    };

    return apiSuccess({ snapshot: payload });
  } catch (error) {
    return apiError(error);
  }
}
