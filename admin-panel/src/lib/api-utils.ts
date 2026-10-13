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
  path?: string;
  syscall?: string;
}

/** The errno codes a filesystem refusal carries; a read's ENOENT is a missing record, not one. */
const FILESYSTEM_ERRNO_CODES = new Set(['EACCES', 'EPERM', 'EROFS', 'ENOSPC', 'EDQUOT', 'EBUSY']);

// Why not 500: the path refused the operation (wrong owner, read-only, full), which is a conflict
// with the target resource rather than an internal crash — and 403 already means "this account
// lacks the permission". The message names the path so the operator knows which one refused.
const FILESYSTEM_REFUSED_STATUS = 409;

function describeFilesystemFailure(err: KnownApiError): string {
  const operation = err.syscall ?? 'access';
  return `${err.code}: cannot ${operation} ${err.path ?? 'the target path'}`;
}

export function apiError(error: unknown): NextResponse {
  console.error('API Error:', error);
  const err = error as KnownApiError;
  const code = err.code;
  let message: string;
  let status = err.status || 500;
  if (code === 'P2002') {
    message = 'A record with these details already exists';
  } else if (code === 'P2025') {
    message = 'Record not found';
  } else if (code !== undefined && FILESYSTEM_ERRNO_CODES.has(code)) {
    message = describeFilesystemFailure(err);
    status = err.status ?? FILESYSTEM_REFUSED_STATUS;
  } else if (err.status != null && err.status < 500) {
    message = err.message || 'An unexpected error occurred';
  } else {
    message = 'An unexpected error occurred';
  }
  const extra = err.errors ? { errors: err.errors } : {};
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}

export function apiSuccess(data?: object): NextResponse {
  if (Array.isArray(data)) return NextResponse.json({ success: true, data });
  return NextResponse.json({ success: true, ...data });
}
