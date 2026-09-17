// How long a watcher waits for a *frame* before calling its connection dead. Why a frame and not a
// log line: a docker build step can be silent for minutes while working perfectly, so silence in the
// deploy output is not evidence of anything. The route sends a status frame at least this often
// (DEPLOY_HEARTBEAT_MS is well inside it), which is what keeps this clock quiet on a healthy watch.
export const DEPLOY_IDLE_TIMEOUT_MS = 5 * 60_000;

// Absolute ceiling on observing one operation, from its start. Past this the watcher stops — the
// operation does not: freeing it is the deploy's own process's business (see deploy-store.ts).
export const DEPLOY_WALL_TIMEOUT_MS = 15 * 60_000;

// How long an operation whose process the panel cannot see is still treated as running before it is
// settled as failed. Only unobservable records age out — a process the panel can still see holds its
// operation (and the deploy guard) until it exits, however long that takes.
export const DEPLOY_STALE_MS = 30 * 60 * 1000;

// Why derived: the failure message naming this bound drifts from it the moment either is edited, and
// a hand-written "30 minutes" is the kind of copy that silently goes stale.
export const DEPLOY_STALE_LABEL = `${DEPLOY_STALE_MS / 60_000} minutes`;

export const DEPLOY_TAIL_LENGTH = 4000;

export const DEPLOY_POLL_MS = 1000;

export const DEPLOY_HEARTBEAT_MS = 15_000;

// How often a mounted panel re-checks whether an operation is waiting for it. Repeating the lookup is
// what lets a panel that is already open settle — and announce — a deploy that finished while this
// tab was not watching it (another tab's deploy, or one whose watch the panel released).
export const DEPLOY_DISCOVERY_INTERVAL_MS = 30_000;

export const DEPLOY_OPERATION_ID_REGEX = /^[0-9a-f]{16}$/;
