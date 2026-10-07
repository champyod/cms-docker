import { NextRequest, NextResponse } from 'next/server';
import { verifyApiPermission } from '@/lib/api-utils';
import { recordAudit } from '@/lib/audit';
import { CREDS_FILE_PREFIX } from '@/lib/creds-file';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const TOKEN_RE = /^[a-f0-9]{48}$/;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  // WHY password:reveal: this endpoint serves the credential CSV, i.e. plaintext
  // passwords. The permission must match the data disclosed, not the user record
  // the token is keyed to.
  const { authorized, response } = await verifyApiPermission('password:reveal');
  if (!authorized) return response;

  const { token } = await params;

  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 404 });
  }

  const tmpdir = os.tmpdir();
  const fileName = `${CREDS_FILE_PREFIX}${token}.csv`;
  const filePath = path.join(tmpdir, fileName);
  const resolved = path.resolve(filePath);

  if (!resolved.startsWith(path.resolve(tmpdir) + path.sep)) {
    return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 404 });
  }

  const usedPath = `${resolved}.used`;

  try {
    await fs.rename(resolved, usedPath);
  } catch {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  try {
    const content = await fs.readFile(usedPath, 'utf-8');

    const timestamp = Date.now();

    await recordAudit({
      verb: 'password:reveal',
      entity: 'user',
      afterValues: { credentialBatchConsumed: true },
      result: 'success',
    });

    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="credentials-${timestamp}.csv"`,
      },
    });
  } finally {
    try {
      await fs.unlink(usedPath);
    } catch {
    }
  }
}
