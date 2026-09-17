import { verifyApiPermission } from '@/lib/api-utils';
import { DEPLOY_HEARTBEAT_MS, DEPLOY_OPERATION_ID_REGEX, DEPLOY_POLL_MS, DEPLOY_TAIL_LENGTH, DEPLOY_WALL_TIMEOUT_MS } from '@/lib/constants/deploy';
import { fetchDeployStatus, type DeployStatusResult, type DeployStatus } from '@/lib/deploy-store';

export const dynamic = 'force-dynamic';

/** The one frame shape both sides agree on: a full status snapshot, never a bare ping. */
interface DeployFrame {
  status: DeployStatus;
  contestId?: number;
  startedAt?: string;
  log: string;
  percent: number | null;
  error?: string;
  warning?: string;
  success: boolean;
}

function snapshot(result: DeployStatusResult): DeployFrame {
  const log = result.log ?? '';
  // Tail last 4000 characters so the payload stays small while the toast and log viewer keep context.
  return {
    status: result.status,
    contestId: result.contestId,
    startedAt: result.startedAt,
    log: log.slice(-DEPLOY_TAIL_LENGTH),
    percent: result.percent ?? null,
    error: result.error,
    warning: result.warning,
    success: result.success,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ operationId: string }> }
) {
  const { operationId } = await params;

  const { authorized, response } = await verifyApiPermission('all:all');
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
  let startedAtMs: number | null = null;
  let closed = false;
  let inFlight = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // Why the timers live out here: a client that goes away must take the watch with it, or every
  // abandoned connection leaves two intervals polling the filesystem forever.
  const stopTimers = (): void => {
    if (pollTimer !== null) clearInterval(pollTimer);
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    pollTimer = null;
    heartbeatTimer = null;
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (frame: DeployFrame): void => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      };

      /**
       * Fetches the operation and, unless it is forced, only sends when something changed.
       *
       * Why the heartbeat is the *same* frame rather than an SSE comment: a comment does not dispatch
       * the client's `onmessage`, so it could not reset its idle watchdog — a docker build step with
       * quiet output then looked like a dead connection. Every frame the client receives is now a
       * status snapshot it already knows how to read, and the timer below guarantees one arrives well
       * inside the watchdog window while the deploy runs.
       */
      const push = async (force: boolean): Promise<boolean> => {
        const result = await fetchDeployStatus(operationId);
        const logLength = result.log?.length ?? 0;
        const percent = result.percent ?? null;
        const changed = logLength !== lastLogLength || result.status !== lastStatus || percent !== lastPercent;

        lastLogLength = logLength;
        lastStatus = result.status;
        lastPercent = percent;
        if (result.startedAt) startedAtMs = new Date(result.startedAt).getTime();

        if (result.status !== 'running') {
          send(snapshot(result));
          return true;
        }

        // Why an absolute ceiling on watching and not on the deploy: the operation keeps its process
        // and its guard (deploy-store settles it when that process exits), so all that ends here is
        // this connection. The client is told, in the copy it shows for a 'timeout', that the deploy
        // continues in the background — which is exactly what is happening.
        if (startedAtMs !== null && Date.now() - startedAtMs > DEPLOY_WALL_TIMEOUT_MS) {
          // `success: false` because a released watch is not a completed deploy, even though the
          // operation behind the frame is still healthy and still running.
          send({ ...snapshot(result), status: 'timeout', success: false });
          return true;
        }

        if (changed || force) send(snapshot(result));
        return false;
      };

      const tick = async (force: boolean): Promise<void> => {
        // Skip rather than queue: two overlapping polls would interleave the bookkeeping above, and a
        // fetch slow enough to overlap is not worth a second one.
        if (inFlight || closed) return;
        inFlight = true;
        try {
          if (await push(force)) {
            stopTimers();
            closed = true;
            controller.close();
          }
        } catch {
          // The stream ends on a failed lookup; the client's EventSource reconnects and tries again.
          stopTimers();
          if (!closed) {
            closed = true;
            controller.close();
          }
        } finally {
          inFlight = false;
        }
      };

      pollTimer = setInterval(() => { void tick(false); }, DEPLOY_POLL_MS);
      heartbeatTimer = setInterval(() => { void tick(true); }, DEPLOY_HEARTBEAT_MS);

      void tick(false);
    },
    cancel() {
      closed = true;
      stopTimers();
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
