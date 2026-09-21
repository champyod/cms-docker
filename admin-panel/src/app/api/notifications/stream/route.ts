import { prisma } from '@/lib/prisma';
import { verifyApiPermission } from '@/lib/api-utils';
import {
  classifyAuditEvent,
  isSubmitBurst,
  SUBMIT_BURST_PER_MINUTE,
  REVEAL_BURST_COUNT,
  REVEAL_BURST_WINDOW_MINUTES,
  ENROL_BURST_COUNT,
  ENROL_BURST_WINDOW_MINUTES,
  NOTIFICATION_COOLDOWN_MS,
  type NotificationEvent,
} from '@/lib/notification-events';

export const dynamic = 'force-dynamic';

const POLL_INTERVAL_MS = 10_000;

// Why module-level: one Next.js instance serves all viewers, so a shared
// cooldown deduplicates Discord pushes across connections. A restart resets
// it, which may resend one round — noisy, never silent.
const lastDiscordAt = new Map<string, number>();

async function sendDiscordThrottled(key: string, title: string, detail: string): Promise<void> {
  const now = Date.now();
  if (now - (lastDiscordAt.get(key) ?? 0) < NOTIFICATION_COOLDOWN_MS) return;
  lastDiscordAt.set(key, now);
  const { logToDiscord } = await import('@/lib/discord-notifier');
  await logToDiscord(title, detail, 15158332, true);
}

interface StreamFrame extends NotificationEvent {
  id: string;
  timestamp: string;
}

/** Critical audit rows since the cursor, as stream frames. */
async function pollAuditFrames(sinceId: bigint): Promise<{ frames: StreamFrame[]; cursor: bigint }> {
  const rows = await prisma.audit_log.findMany({
    where: { id: { gt: sinceId } },
    orderBy: { id: 'asc' },
    take: 100,
    select: { id: true, verb: true, entity: true, entity_id: true, result: true, actor_id: true, timestamp: true },
  });
  const frames: StreamFrame[] = [];
  let cursor = sinceId;
  for (const row of rows) {
    cursor = row.id;
    if (row.result !== 'success' && row.result !== 'failure') continue;
    const event = classifyAuditEvent(row.verb, row.entity, row.entity_id, row.result, row.actor_id);
    if (event) {
      frames.push({ ...event, id: `audit-${row.id}`, timestamp: row.timestamp.toISOString() });
    }
  }
  return { frames, cursor };
}

/** Submit bursts and reveal/enrolment bursts, with throttled Discord push. */
async function pollBurstFrames(): Promise<StreamFrame[]> {
  const frames: StreamFrame[] = [];
  const now = new Date().toISOString();

  const minuteAgo = new Date(Date.now() - 60_000);
  const submitCounts = await prisma.submissions.groupBy({
    by: ['participation_id'],
    where: { timestamp: { gte: minuteAgo } },
    _count: { _all: true },
  });
  for (const row of submitCounts) {
    const count = row._count._all;
    if (!isSubmitBurst(count)) continue;
    const key = `submit-burst-${row.participation_id}`;
    frames.push({
      id: `${key}-${Date.now()}`,
      level: 'warning',
      title: 'Unusual submit frequency',
      detail: `Participation #${row.participation_id} submitted ${count} times in the last minute (threshold ${SUBMIT_BURST_PER_MINUTE})`,
      timestamp: now,
    });
    await sendDiscordThrottled(key, 'Unusual submit frequency', frames[frames.length - 1].detail);
  }

  const windowStart = new Date(Date.now() - REVEAL_BURST_WINDOW_MINUTES * 60_000);
  const revealCounts = await prisma.audit_log.groupBy({
    by: ['actor_id'],
    where: { verb: 'password:reveal', timestamp: { gte: windowStart } },
    _count: { _all: true },
  });
  for (const row of revealCounts) {
    if (row.actor_id === null || row._count._all < REVEAL_BURST_COUNT) continue;
    const key = `reveal-burst-${row.actor_id}`;
    const detail = `Admin #${row.actor_id} revealed ${row._count._all} passwords in ${REVEAL_BURST_WINDOW_MINUTES} minutes`;
    frames.push({ id: `${key}-${Date.now()}`, level: 'warning', title: 'Unusual reveal burst', detail, timestamp: now });
    await sendDiscordThrottled(key, 'Unusual reveal burst', detail);
  }

  const enrolStart = new Date(Date.now() - ENROL_BURST_WINDOW_MINUTES * 60_000);
  const enrolCount = await prisma.audit_log.count({
    where: { verb: { in: ['participation:create', 'participation:delete'] }, timestamp: { gte: enrolStart } },
  });
  if (enrolCount >= ENROL_BURST_COUNT) {
    const detail = `${enrolCount} enrolment changes in ${ENROL_BURST_WINDOW_MINUTES} minutes`;
    frames.push({ id: `enrol-burst-${Date.now()}`, level: 'warning', title: 'Unusual enrolment burst', detail, timestamp: now });
    await sendDiscordThrottled('enrol-burst', 'Unusual enrolment burst', detail);
  }
  return frames;
}

export async function GET(request: Request): Promise<Response> {
  // Why audit:read with no exception: every frame derives from audit rows or
  // admin-only aggregates, so the audit gate is the correct boundary.
  const { authorized, response } = await verifyApiPermission('audit:read');
  if (!authorized) return response;

  const url = new URL(request.url);
  let cursor: bigint;
  try {
    cursor = BigInt(url.searchParams.get('since') ?? 0);
  } catch {
    cursor = BigInt(0);
  }

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const push = (frame: StreamFrame): void => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      };
      const poll = async (): Promise<void> => {
        if (closed) return;
        try {
          const audit = await pollAuditFrames(cursor);
          cursor = audit.cursor;
          for (const frame of audit.frames) push(frame);
          for (const frame of await pollBurstFrames()) push(frame);
        } catch {
          // Why swallow: a failed poll must not kill the stream; the next tick retries.
        }
      };
      await poll();
      timer = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
      request.signal.addEventListener('abort', () => {
        closed = true;
        if (timer !== null) clearInterval(timer);
        controller.close();
      });
    },
    cancel() {
      closed = true;
      if (timer !== null) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
