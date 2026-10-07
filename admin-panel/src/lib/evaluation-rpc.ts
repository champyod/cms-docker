const EVALUATION_RPC_ENDPOINT = 'http://cms-admin-web-server:25000/rpc/EvaluationService/0/invalidate_submission';
export const EVALUATION_RPC_TIMEOUT_MS = 10_000;

export interface RpcResult {
  accepted: boolean;
  timedOut: boolean;
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

/** Asks the EvaluationService to invalidate a submission; bounded by EVALUATION_RPC_TIMEOUT_MS so a dead service fails fast instead of hanging the action. */
export async function invalidateViaRpc(submissionId: number, datasetId: number | null, level: string): Promise<RpcResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EVALUATION_RPC_TIMEOUT_MS);
  try {
    const response = await fetch(EVALUATION_RPC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level,
        submission_id: submissionId,
        dataset_id: datasetId,
      }),
      signal: controller.signal,
    });

    return { accepted: response.ok, timedOut: false };
  } catch (error) {
    return { accepted: false, timedOut: isAbortError(error) };
  } finally {
    clearTimeout(timer);
  }
}
