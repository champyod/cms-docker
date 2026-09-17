// Why one module for these numbers: the client watchdog window is derived from the heartbeat, and
// each stream's sampling cadence is the poll interval it replaced. Split apart, either can drift and
// silently change what the operator sees or how often the panel wakes up.

/** Host counters: what the resources page used to poll once a second. */
export const RESOURCE_SERVER_POLL_MS = 1000;

/** Worker, core-service and traffic summaries: each replaced a 5-second poll. */
export const RESOURCE_SUMMARY_POLL_MS = 5000;

/** Container state: what the containers page used to poll every 10 seconds. */
export const CONTAINERS_POLL_MS = 10_000;

/**
 * How often a stream restates its last snapshot even when nothing changed.
 *
 * Why it is a real frame and not an SSE comment: a comment never dispatches the client's `onmessage`,
 * so it could not hold the watchdog open — the deploy stream made the same choice for the same
 * reason.
 */
export const LIVE_HEARTBEAT_MS = 15_000;

/**
 * How long the client tolerates silence before it treats the connection as dead.
 *
 * Why derived from the heartbeat: one frame may be late without the connection being gone, but three
 * missed heartbeats in a row are not a network hiccup.
 */
export const LIVE_IDLE_TIMEOUT_MS = LIVE_HEARTBEAT_MS * 3;

/** How often the client re-checks that watchdog clock. */
export const LIVE_WATCHDOG_CHECK_MS = LIVE_HEARTBEAT_MS;

/** Reconnect delays double from the minimum up to the ceiling, so a panel that is down is not hammered. */
export const LIVE_RECONNECT_MIN_MS = 1000;
export const LIVE_RECONNECT_MAX_MS = 30_000;

/** The traffic table's page sizes; the stream validates its request against the same list the UI offers. */
export const TRAFFIC_LOG_LIMIT_OPTIONS: readonly number[] = [10, 20, 30, 50];
export const TRAFFIC_LOG_LIMIT_DEFAULT = 20;

/**
 * Headers every live stream answers with.
 *
 * Why `X-Accel-Buffering: no`: a reverse proxy that buffers would hold frames until it had a buffer
 * full of them, which is indistinguishable from a dead connection on the panel side.
 */
export const LIVE_STREAM_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};
