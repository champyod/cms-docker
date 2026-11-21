import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getUsers } from '@/app/api/users/route';
import { POST as postTeam } from '@/app/api/teams/route';
import { PUT as putSubmission } from '@/app/api/submissions/[id]/route';
import { getSession } from '@/lib/auth';
import { getFreshPermissions } from '@/lib/permissions';

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/permissions', () => ({ getFreshPermissions: vi.fn() }));

const mockGetSession = vi.mocked(getSession);
const mockGetFreshPermissions = vi.mocked(getFreshPermissions);

describe('People and Evaluation API permission boundaries', () => {
  it('returns 401 when no session exists', async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await getUsers(new NextRequest('http://localhost/api/users'));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns 403 for an authenticated caller without user:list', async () => {
    mockGetSession.mockResolvedValue({ userId: '1', username: 'admin', expiresAt: '2099-01-01' });
    mockGetFreshPermissions.mockResolvedValue(new Set());

    const response = await getUsers(new NextRequest('http://localhost/api/users'));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden: Missing user:list permission' });
  });

  it('returns 403 for an authenticated caller without team:create', async () => {
    mockGetSession.mockResolvedValue({ userId: '1', username: 'admin', expiresAt: '2099-01-01' });
    mockGetFreshPermissions.mockResolvedValue(new Set());

    const response = await postTeam(new NextRequest('http://localhost/api/teams', {
      method: 'POST',
      body: JSON.stringify({ code: 'A-1', name: 'Alpha' }),
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden: Missing team:create permission' });
  });

  it('returns 403 for an authenticated caller without submission:update', async () => {
    mockGetSession.mockResolvedValue({ userId: '1', username: 'admin', expiresAt: '2099-01-01' });
    mockGetFreshPermissions.mockResolvedValue(new Set());

    const response = await putSubmission(
      new NextRequest('http://localhost/api/submissions/19', {
        method: 'PUT',
        body: JSON.stringify({ action: 'comment', comment: 'updated' }),
      }),
      { params: Promise.resolve({ id: '19' }) },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden: Missing submission:update permission' });
  });
});
