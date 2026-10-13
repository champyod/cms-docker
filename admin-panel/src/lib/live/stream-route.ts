import { verifyApiPermission } from '@/lib/api-utils';
import { LIVE_HEARTBEAT_MS, LIVE_STREAM_HEADERS } from '@/lib/constants/live-stream';
import type { SessionPayload } from '@/lib/auth';
import type { PermissionKey } from '@/lib/permissions';

export type LiveFrameSink<TFrame> = (frame: TFrame) => void;

/** One connection's wiring: what a source may push, and what it must stop on. */
export interface LiveConnection<TFrame> {
  readonly request: Request;
  readonly session: SessionPayload;
  readonly emit: LiveFrameSink<TFrame>;
  readonly isClosed: () => boolean;
  readonly close: () => void;
}

export type LiveSourceTeardown = () => void;

/** Wires a connection's data; the returned teardown runs when the client goes away or the stream fails. */
export type LiveSource<TFrame> = (
  connection: LiveConnection<TFrame>,
) => LiveSourceTeardown | Promise<LiveSourceTeardown>;

/**
 * What a heartbeat carries when nothing changed.
 *
 * `restate` repeats the last frame so a snapshot consumer can hold its own watchdog; `empty` sends a
 * frame the notification client drops, because repeating an alert frame would alert twice.
 */
export type LiveHeartbeat = 'restate' | 'empty';

export interface LiveStreamRouteOptions<TFrame> {
  /** Gate keys, checked in order on every connection; the first refusal becomes the response. */
  readonly permissions: readonly [PermissionKey, ...PermissionKey[]];
  readonly heartbeat: LiveHeartbeat;
  readonly source: LiveSource<TFrame>;
}

/**
 * The frame the client's `onmessage` receives and drops.
 *
 * Why a real frame and not an SSE comment: a comment never dispatches `onmessage`, so it could not
 * hold the client's watchdog open.
 */
const EMPTY_FRAME = 'data: {}\n\n';

type GateResult = { readonly refusal: Response } | { readonly session: SessionPayload };

/** The gate's answer: the first refused key's response, or the session every key authorised. */
async function openGate(permissions: readonly [PermissionKey, ...PermissionKey[]]): Promise<GateResult> {
  const [opening, ...rest] = permissions;
  const first = await verifyApiPermission(opening);
  if (!first.authorized) return { refusal: first.response };
  for (const permission of rest) {
    const next = await verifyApiPermission(permission);
    if (!next.authorized) return { refusal: next.response };
  }
  return { session: first.session };
}

/**
 * Builds one live stream route: the permission gate, the frame shape, the heartbeat, and the cleanup
 * that a disconnect or a failed source must run.
 *
 * Why one builder for every stream: the three routes this replaced each carried their own copy of the
 * encoder, the closed flag, the abort listener and the heartbeat, and every new surface had to repeat
 * them. Here a route declares its gate, its heartbeat policy and a source, and nothing else.
 */
export function createLiveStreamRoute<TFrame>(
  options: LiveStreamRouteOptions<TFrame>,
): (request: Request) => Promise<Response> {
  return async function liveStreamRoute(request: Request): Promise<Response> {
    const gate = await openGate(options.permissions);
    if ('refusal' in gate) return gate.refusal;

    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    let teardown: LiveSourceTeardown | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let lastFrame: string | null = null;
    let closed = false;

    const enqueue = (chunk: string): void => {
      if (closed || controller === null) return;
      controller.enqueue(encoder.encode(chunk));
    };

    const release = (): void => {
      closed = true;
      request.signal.removeEventListener('abort', finish);
      if (heartbeat !== null) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      teardown?.();
      teardown = null;
    };

    const finish = (): void => {
      release();
      const ending = controller;
      controller = null;
      ending?.close();
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(streamController) {
        controller = streamController;
        // Why the heartbeat is armed before the first sample: a probe slow enough to outlast its own
        // interval must not leave the client's watchdog counting down on its own.
        heartbeat = setInterval(() => {
          if (options.heartbeat === 'empty') {
            enqueue(EMPTY_FRAME);
            return;
          }
          if (lastFrame !== null) enqueue(lastFrame);
        }, LIVE_HEARTBEAT_MS);
        try {
          teardown = await options.source({
            request,
            session: gate.session,
            emit: (frame) => {
              lastFrame = `data: ${JSON.stringify(frame)}\n\n`;
              enqueue(lastFrame);
            },
            isClosed: () => closed,
            close: finish,
          });
        } catch {
          // A source that cannot start ends the stream rather than the page; the client reconnects.
          finish();
          return;
        }
        // Why the teardown still runs: a source that failed during its own start has already ended the
        // connection, and its timers must not outlive it.
        if (closed) release();
      },
      cancel() {
        release();
        controller = null;
      },
    });

    request.signal.addEventListener('abort', finish);
    return new Response(stream, { headers: LIVE_STREAM_HEADERS });
  };
}
