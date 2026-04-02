import { cookies } from 'next/headers';
import { decrypt, encrypt } from '@/lib/auth';

const RANKING_SESSION_COOKIE = 'ranking_session';
const SESSION_DURATION_MS = 2 * 60 * 60 * 1000;
const isSecureCookie = process.env.COOKIE_SECURE === 'true';

type RankingSessionPayload = {
  baseUrl: string;
  username: string;
  password: string;
  expiresAt: string;
};

export function normalizeRankingBaseUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl.trim());
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Ranking URL must use http or https');
  }
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export async function setRankingSession(baseUrl: string, username: string, password: string) {
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const token = await encrypt({
    type: 'ranking-session',
    baseUrl,
    username,
    password,
    expiresAt: expiresAt.toISOString(),
  });

  (await cookies()).set(RANKING_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecureCookie,
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });
}

export async function clearRankingSession() {
  (await cookies()).delete(RANKING_SESSION_COOKIE);
}

export async function getRankingSession(): Promise<RankingSessionPayload | null> {
  const token = (await cookies()).get(RANKING_SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const payload = await decrypt(token);
    if (payload?.type !== 'ranking-session') return null;
    if (!payload.baseUrl || !payload.username || !payload.password || !payload.expiresAt) return null;

    if (Date.now() > new Date(payload.expiresAt).getTime()) {
      await clearRankingSession();
      return null;
    }

    return {
      baseUrl: String(payload.baseUrl),
      username: String(payload.username),
      password: String(payload.password),
      expiresAt: String(payload.expiresAt),
    };
  } catch {
    return null;
  }
}

export function buildRankingAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}
