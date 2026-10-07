import { createConnection } from 'node:net';

const EVALUATION_RPC_HOST = 'cms-evaluation-service';
const EVALUATION_RPC_PORT = 25000;
export const EVALUATION_RPC_TIMEOUT_MS = 10_000;
// Mirrors cms.io.rpc.RPCBase.MAX_MESSAGE_SIZE — larger frames are rejected by the service.
const MAX_RPC_FRAME_BYTES = 1024 * 1024;

export interface RpcResult {
  accepted: boolean;
  timedOut: boolean;
}

interface RpcResponse {
  __data: unknown;
  __error: string | null;
}

/**
 * Asks the EvaluationService to invalidate a submission over the CMS raw RPC
 * protocol (single-line JSON frames terminated by CRLF — see cms/io/rpc.py).
 * Requests carry `__secret` (from RPC_SECRET, injected into config/cms.toml);
 * the service fails closed without it, so a missing secret is reported as
 * accepted:false without opening a connection. Bounded by
 * EVALUATION_RPC_TIMEOUT_MS so a dead service fails fast; transport or service
 * errors surface as accepted:false without being swallowed by callers.
 */
export async function invalidateViaRpc(
  submissionId: number,
  datasetId: number | null,
  level: string,
): Promise<RpcResult> {
  const secret = process.env.RPC_SECRET;
  if (!secret) {
    return { accepted: false, timedOut: false };
  }

  const request = JSON.stringify({
    __id: 1,
    __method: 'invalidate_submission',
    __data: { level, submission_id: submissionId, dataset_id: datasetId },
    __secret: secret,
  });

  return await new Promise<RpcResult>((resolve) => {
    let settled = false;
    let buffer = '';
    const socket = createConnection({ host: EVALUATION_RPC_HOST, port: EVALUATION_RPC_PORT });

    // Declared as a hoisted function so it can close over `timer`, which is
    // created after it but always fires (or is cleared) only after that.
    function settle(result: RpcResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    }

    const timer = setTimeout(() => settle({ accepted: false, timedOut: true }), EVALUATION_RPC_TIMEOUT_MS);

    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${request}\r\n`));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const boundary = buffer.indexOf('\r\n');
      if (boundary === -1) {
        if (buffer.length > MAX_RPC_FRAME_BYTES) {
          settle({ accepted: false, timedOut: false });
        }
        return;
      }
      try {
        const response = JSON.parse(buffer.slice(0, boundary)) as RpcResponse;
        settle({ accepted: response.__error === null, timedOut: false });
      } catch {
        settle({ accepted: false, timedOut: false });
      }
    });
    socket.on('error', () => settle({ accepted: false, timedOut: false }));
    socket.on('close', () => settle({ accepted: false, timedOut: false }));
  });
}
