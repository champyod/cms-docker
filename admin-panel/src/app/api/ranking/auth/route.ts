import { NextRequest } from 'next/server';
import { apiError, apiSuccess, verifyApiPermission } from '@/lib/api-utils';
import { buildRankingAuthHeader, clearRankingSession, getRankingSession, normalizeRankingBaseUrl, setRankingSession } from '@/lib/ranking-session';

export async function GET() {
  const { authorized, response } = await verifyApiPermission('all');
  if (!authorized) return response;

  const session = await getRankingSession();
  if (!session) {
    return apiSuccess({ connected: false });
  }

  return apiSuccess({
    connected: true,
    baseUrl: session.baseUrl,
    username: session.username,
  });
}

export async function POST(req: NextRequest) {
  const { authorized, response } = await verifyApiPermission('all');
  if (!authorized) return response;

  try {
    const body = await req.json();
    const baseUrl = normalizeRankingBaseUrl(String(body?.baseUrl ?? ''));
    const username = String(body?.username ?? '').trim();
    const password = String(body?.password ?? '');

    if (!username || !password) {
      return apiError({ status: 400, message: 'Username and password are required' });
    }

    const res = await fetch(`${baseUrl}/config`, {
      method: 'GET',
      headers: {
        Authorization: buildRankingAuthHeader(username, password),
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return apiError({ status: 401, message: `Ranking auth failed (${res.status})` });
    }

    await setRankingSession(baseUrl, username, password);

    return apiSuccess({ connected: true, baseUrl, username });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE() {
  const { authorized, response } = await verifyApiPermission('all');
  if (!authorized) return response;

  await clearRankingSession();
  return apiSuccess({ connected: false });
}
