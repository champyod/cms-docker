/**
 * Client for the CMS RPC proxy exposed by the Admin Web Server.
 *
 * WHY this exists as its own module: two server actions call different EvaluationService
 * methods, and the endpoint was previously duplicated as a literal in each — which is how
 * both copies ended up pointing at the same wrong port.
 *
 * WHY port 8889 and not 25000: the proxy is mounted by `WebService` at `/rpc` on the
 * AdminWebServer's *HTTP* application (`DispatcherMiddleware(wsgi_app, {"/rpc": RPCMiddleware})`
 * in src/cms/io/web_service.py), and `[admin_web_server] listen_port = 8889`. Port 25000
 * belongs to EvaluationService (`[services] EvaluationService = [["cms-evaluation-service",
 * 25000]]`), a different container, so `cms-admin-web-server:25000` could never answer and
 * every call fell through to its fallback.
 */
const EVALUATION_RPC_BASE_URL =
  process.env.CMS_EVALUATION_RPC_BASE_URL ?? 'http://cms-admin-web-server:8889';

const EVALUATION_RPC_TIMEOUT_MS = 5000;

/**
 * Call one EvaluationService method through the Admin Web Server's RPC proxy.
 *
 * Returns null on any transport, timeout, HTTP, or protocol failure. Callers treat the
 * result as best-effort context and fall back to the database, so a null here must never
 * be presented as a definitive answer.
 *
 * WHY POST with a JSON body: the proxy passes the body through as the method's keyword
 * arguments, so a no-argument method still needs a body — an empty object.
 */
export async function callEvaluationRpc(
  method: string,
  params: Readonly<Record<string, unknown>> = {},
): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EVALUATION_RPC_TIMEOUT_MS);

  try {
    const response = await fetch(`${EVALUATION_RPC_BASE_URL}/rpc/EvaluationService/0/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Unwrap the proxy's `{data, error}` envelope.
 *
 * WHY strict: anything that is not that exact shape means the service is not really
 * answering, and a caller must not read a partial body as data.
 */
export function unwrapRpcEnvelope(body: unknown): unknown | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const { data, error } = body as { data?: unknown; error?: unknown };
  if (error !== null && error !== undefined) {
    return null;
  }
  return data;
}
