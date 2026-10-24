import { NextResponse, type NextRequest } from 'next/server';

import { recordAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { resolveRootActorId } from '@/lib/panel-actions/root-actor';
import {
  applyFeedPush,
  consumeFeedRateLimit,
  feedTokenMatches,
  MAX_BODY_BYTES,
  parseFeedPush,
} from '@/lib/security/patching-ingest';

export const runtime = 'nodejs';

// The feed's one endpoint: Diun, the host rootfs scan and osv-scanner all POST here.
// WHY no cookie/session path: this is machine-to-machine inside the tailnet, and a producer
// has no admin account to authenticate as. The bearer token is the whole identity, and the
// audit row it produces names the source rather than inventing an administrator.
function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

function declaredTooLarge(request: NextRequest): boolean {
  const declared = request.headers.get('content-length');
  if (declared === null) return false;
  const bytes = Number(declared);
  return Number.isFinite(bytes) && bytes > MAX_BODY_BYTES;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!feedTokenMatches(request.headers.get('authorization'))) {
    return json({ success: false, error: 'Unauthorized' }, 401);
  }

  if (declaredTooLarge(request)) {
    return json({ success: false, error: `Body exceeds ${MAX_BODY_BYTES} bytes` }, 413);
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return json({ success: false, error: 'Body could not be read' }, 422);
  }
  // Why the byte length and not `raw.length`: a multi-byte character counts once in JS but
  // occupies more than one byte on the wire, so the cap has to measure what was sent.
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return json({ success: false, error: `Body exceeds ${MAX_BODY_BYTES} bytes` }, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ success: false, error: 'Body is not valid JSON' }, 422);
  }

  const parsed = parseFeedPush(body);
  if (!parsed.ok) {
    return json(
      {
        success: false,
        error: parsed.error,
        ...(parsed.index === undefined ? {} : { index: parsed.index }),
      },
      422,
    );
  }
  const push = parsed.value;

  const limit = consumeFeedRateLimit(push.source);
  if (!limit.allowed) {
    return NextResponse.json(
      { success: false, error: `Rate limit exceeded for ${push.source}` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  // WHY the actor is resolved BEFORE anything is written: `audit_log.actor_id` is nullable, and
  // the operator's standing rule is that the trail never files a write as NULL. Resolving first
  // means a deployment with no seeded `root` admin refuses the push outright instead of storing
  // findings nobody is accountable for — a stored push always has its audit row. The producer is
  // still named in afterValues, so the row reads as "root, on behalf of diun|rootfs|osv".
  let actorId: number;
  try {
    actorId = await resolveRootActorId();
  } catch (error) {
    console.error('security feed ingest refused: no root actor to attribute the push to:', error);
    return json({ success: false, error: 'No actor to attribute this push to' }, 500);
  }

  try {
    const result = await prisma.$transaction((tx) => applyFeedPush(tx, push));
    // Exactly one audit row per accepted push: the row is the only record that a producer
    // spoke, so it is written once for the whole batch rather than per finding.
    await recordAudit({
      actorId,
      verb: 'security.findings.ingest',
      entity: 'security_findings',
      entityId: push.source,
      afterValues: {
        actor: push.source,
        source: push.source,
        host: push.host,
        received: result.received,
        resolved: result.resolved,
        complete: push.complete,
      },
      result: 'success',
    });
    return json(
      {
        success: true,
        source: push.source,
        received: result.received,
        resolved: result.resolved,
        complete: push.complete,
      },
      201,
    );
  } catch (error) {
    // Why a fixed message and a server-side log: a producer must never receive a Prisma
    // message (it can name columns and constraint internals) in place of a status code.
    console.error('security feed ingest failed:', error);
    return json({ success: false, error: 'The push could not be stored' }, 500);
  }
}
