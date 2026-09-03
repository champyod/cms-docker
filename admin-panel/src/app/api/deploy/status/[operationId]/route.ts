import { verifyApiPermission } from '@/lib/api-utils';
import { DEPLOY_HEARTBEAT_MS, DEPLOY_IDLE_TIMEOUT_MS, DEPLOY_OPERATION_ID_REGEX, DEPLOY_POLL_MS, DEPLOY_TAIL_LENGTH } from '@/lib/constants/deploy';
import { fetchDeployStatus } from '@/lib/deploy-store';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ operationId: string }> }
) {
  const { operationId } = await params;

  const { authorized, response } = await verifyApiPermission('all');
  if (!authorized) return response;

  if (!DEPLOY_OPERATION_ID_REGEX.test(operationId)) {
    return new Response(JSON.stringify({ error: 'Invalid operation identifier' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  let lastLogLength = -1;
  let lastStatus: string | null = null;
  let lastPercent: number | null = null;
  let lastChangeAt = Date.now();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (payload: unknown) => {
        if (closed) return;
        const data = JSON.stringify(payload);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      const sendHeartbeat = () => {
        if (closed) return;
        controller.enqueue(encoder.encode(`: heartbeat\n\n`));
      };

      // Why idle 60 seconds from last log change: docker pull may run for minutes on slow links but always appends to log; timeout only when no change proves hung process, not elapsed wall time.
      const checkAndPush = async (): Promise<boolean> => {
        const result = await fetchDeployStatus(operationId);
        const logLength = result.log?.length ?? 0;
        const percent = result.percent ?? null;
        const statusChanged = result.status !== lastStatus;
        const logChanged = logLength !== lastLogLength;
        const percentChanged = percent !== lastPercent;

        if (logChanged) {
          lastChangeAt = Date.now();
          lastLogLength = logLength;
        }
        if (percentChanged) lastPercent = percent;
        if (statusChanged) lastStatus = result.status;

        const isTerminal = result.status !== 'running';

        if (logChanged || statusChanged || percentChanged || isTerminal) {
          // Tail last 4000 characters so payload stays small while toast and log viewer have recent context.
          const tail = result.log ? result.log.slice(-DEPLOY_TAIL_LENGTH) : '';
          sendEvent({
            status: result.status,
            contestId: result.contestId,
            startedAt: result.startedAt,
            log: tail,
            fullLength: logLength,
            percent,
            error: result.error,
            success: result.success,
          });
        }

        if (isTerminal) {
          return true;
        }

        const idleMs = Date.now() - lastChangeAt;
        if (idleMs > DEPLOY_IDLE_TIMEOUT_MS) {
          sendEvent({
            status: 'timeout' as const,
            contestId: result.contestId,
            startedAt: result.startedAt,
            log: result.log ? result.log.slice(-DEPLOY_TAIL_LENGTH) : '',
            fullLength: logLength,
            percent,
            error: 'Deploy timed out after 60 seconds without log output.',
            success: false,
          });
          return true;
        }

        return false;
      };

      const interval = setInterval(async () => {
        try {
          const done = await checkAndPush();
          if (done) {
            clearInterval(interval);
            clearInterval(heartbeat);
            closed = true;
            controller.close();
          }
        } catch {
          clearInterval(interval);
          clearInterval(heartbeat);
          if (!closed) {
            closed = true;
            controller.close();
          }
        }
      }, DEPLOY_POLL_MS);

      const heartbeat = setInterval(sendHeartbeat, DEPLOY_HEARTBEAT_MS);

      try {
        const done = await checkAndPush();
        if (done) {
          clearInterval(interval);
          clearInterval(heartbeat);
          closed = true;
          controller.close();
        }
      } catch {
        clearInterval(interval);
        clearInterval(heartbeat);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }

    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
