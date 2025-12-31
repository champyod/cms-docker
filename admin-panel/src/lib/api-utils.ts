import { getSession } from './auth';
import { NextResponse } from 'next/server';

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

export function apiError(error: any) {
  console.error('API Error:', error);
  const message = error.message || 'An unexpected error occurred';
  const status = error.status || 500;
  return NextResponse.json({ success: false, error: message }, { status });
}

export function apiSuccess(data?: any) {
  return NextResponse.json({ success: true, ...data });
}
