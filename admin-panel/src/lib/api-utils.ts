import { getSession, type SessionPayload } from './auth';
import { getFreshPermissions, type PermissionKey } from '@/lib/permissions';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { NextResponse } from 'next/server';

// Why: `?: undefined` on the absent branch mirrors TypeScript's inferred shape for the old
// return values, so existing destructuring call sites (`{ authorized, response }`) keep compiling.
export type ApiAuthResult =
  | { authorized: false; response: NextResponse; session?: undefined }
  | { authorized: true; session: SessionPayload; response?: undefined };

export function sanitize<T>(value: T | undefined | null): T | null {
  if (value === undefined || value === null || value === '$undefined') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (Array.isArray(value)) return value.map((item) => (item === '$undefined' || item === '' ? null : item)) as unknown as T;
  return value;
}

export async function verifyApiAuth(): Promise<ApiAuthResult> {
  const session = await getSession();
  if (!session) {
    return { authorized: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { authorized: true, session };
}

export async function verifyApiPermission(permission: PermissionKey): Promise<ApiAuthResult> {
  const session = await getSession();
  if (!session) {
    return { authorized: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const effective = await getFreshPermissions(session.userId);
  if (!effective) {
    return { authorized: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  if (!hasEffectivePermission(effective, permission)) {
    return { authorized: false, response: NextResponse.json({ error: `Forbidden: Missing ${permission} permission` }, { status: 403 }) };
  }

  return { authorized: true, session };
}

interface KnownApiError {
  code?: string;
  status?: number;
  message?: string;
  errors?: unknown;
}

export function apiError(error: unknown): NextResponse {
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

export function apiSuccess(data?: object): NextResponse {
  if (Array.isArray(data)) return NextResponse.json({ success: true, data });
  return NextResponse.json({ success: true, ...data });
}
