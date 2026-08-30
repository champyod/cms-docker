import { getSession } from './auth';
import { getFreshPermissions, hasPermission } from '@/lib/permissions';
import { NextResponse } from 'next/server';
import type { Permission } from './permissions';

export function sanitize<T>(value: T | undefined | null): T | null {
  if (value === undefined || value === null || value === '$undefined') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (Array.isArray(value)) return value.map((item) => (item === '$undefined' || item === '' ? null : item)) as unknown as T;
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

  if (!hasPermission(fresh, permission)) {
    return { authorized: false as const, response: NextResponse.json({ error: `Forbidden: Missing ${permission} permission` }, { status: 403 }) };
  }

  return { authorized: true as const, session };
}

interface KnownApiError {
  code?: string;
  status?: number;
  message?: string;
  errors?: unknown;
}

export function apiError(error: unknown) {
  console.error('API Error:', error);
  const err = error as KnownApiError;
  const code = err.code;
  let message: string;
  if (code === 'P2002') {
    message = 'A record with these details already exists';
  } else if (code === 'P2025') {
    message = 'Record not found';
  } else if (err.status != null && err.status < 500) {
    message = err.message || 'An unexpected error occurred';
  } else {
    message = 'An unexpected error occurred';
  }
  const status = err.status || 500;
  const extra = err.errors ? { errors: err.errors } : {};
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}

export function apiSuccess(data?: object) {
  return NextResponse.json({ success: true, ...data });
}
