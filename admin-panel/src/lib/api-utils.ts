import { getSession } from './auth';
import { getFreshPermissions } from '@/lib/permissions';
import { NextResponse } from 'next/server';
import type { Permission } from './permissions';

export function sanitize<T>(value: T | undefined | null): T | null {
  if (value === undefined || value === null || (value as any) === '$undefined') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (Array.isArray(value)) return value.map(v => (v === '$undefined' || v === '' ? null : v)) as unknown as T;
  return value;
}

export async function verifyApiAuth() {
  const session = await getSession();
  if (!session) {
    return { authorized: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { authorized: true, session };
}

export async function verifyApiPermission(permission: Permission) {
  const session = await getSession();
  if (!session) {
    return { authorized: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const fresh = await getFreshPermissions(session.userId);
  if (!fresh) {
    return { authorized: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const hasPermission =
    fresh.all ||
    (permission === 'contests' && fresh.contests) ||
    (permission === 'tasks' && fresh.tasks) ||
    (permission === 'users' && fresh.users) ||
    (permission === 'messaging' && fresh.messaging);

  if (!hasPermission) {
    return { authorized: false as const, response: NextResponse.json({ error: `Forbidden: Missing ${permission} permission` }, { status: 403 }) };
  }

  return { authorized: true as const, session };
}

export function apiError(error: any) {
  console.error('API Error:', error);
  const code = (error as { code?: string }).code;
  let message: string;
  if (code === 'P2002') {
    message = 'A record with these details already exists';
  } else if (code === 'P2025') {
    message = 'Record not found';
  } else if (error.status != null && error.status < 500) {
    message = error.message || 'An unexpected error occurred';
  } else {
    message = 'An unexpected error occurred';
  }
  const status = error.status || 500;
  const extra = error.errors ? { errors: error.errors } : {};
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}

export function apiSuccess(data?: any) {
  return NextResponse.json({ success: true, ...data });
}
