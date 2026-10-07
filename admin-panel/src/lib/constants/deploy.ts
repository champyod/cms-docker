// How long a watcher waits for a *frame* before calling its connection dead. Why a frame and not a
// log line: a docker build step can be silent for minutes while working perfectly, so silence in the
// deploy output is not evidence of anything. The route sends a status frame at least this often
// (DEPLOY_HEARTBEAT_MS is well inside it), which is what keeps this clock quiet on a healthy watch.
export const DEPLOY_IDLE_TIMEOUT_MS = 5 * 60_000;

// Absolute ceiling on observing one operation, from its start. Past this the watcher stops — the
// operation does not: it ends when its process does, or when nothing can be observed about that process
// for long enough (see deploy-store.ts and DEPLOY_UNOBSERVABLE_MS).
export const DEPLOY_WALL_TIMEOUT_MS = 15 * 60_000;

// How long an operation that recorded no process of its own is still treated as running before it is
// settled as failed. Only records with nothing to wait for age out by this bound: a process the panel
// *can* see holds its operation (and the deploy guard) until it exits, however long that takes, and a
// record naming a process the panel cannot see at all is aged by DEPLOY_UNOBSERVABLE_MS instead.
export const DEPLOY_STALE_MS = 30 * 60 * 1000;

// Why derived: the failure message naming this bound drifts from it the moment either is edited, and
// a hand-written "30 minutes" is the kind of copy that silently goes stale.
export const DEPLOY_STALE_LABEL = `${DEPLOY_STALE_MS / 60_000} minutes`;

// How long an operation whose process this panel cannot see *at all* — its record names a pid namespace
// that is not this panel's — still counts as running before the panel may end it without a witness. Why a
// bound at all: without one, a record whose process table is gone reports running forever, holds
// active.lock forever and refuses every later deploy with no way out of the UI. What the bound cannot tell
// apart, and why it stands in for evidence rather than being evidence: the container that spawned the
// deploy being gone and a *second* panel container of the same service building against this shared logs
// directory right now look identical from here — a freed pid namespace answers no questions, and the two
// panels hold no lock that spans them. What the panel checks first, because it can: an operation whose log
// was written to within DEPLOY_LOG_ACTIVITY_MS is still being fed output by the panel that owns that
// process table, and stays running (see deploy-store's `probeDeployProcess`). What is left is this bound's
// trade, stated plainly: an operation past this age whose log has been silent for longer than
// DEPLOY_LOG_ACTIVITY_MS is settled as failed — config.toml reverted, the guard freed — even if a second
// panel's build is still running, which then has no record left to report its result into.
export const DEPLOY_UNOBSERVABLE_MS = 2 * 60 * 60 * 1000;

// Derived for the same reason as DEPLOY_STALE_LABEL.
export const DEPLOY_UNOBSERVABLE_LABEL = `${DEPLOY_UNOBSERVABLE_MS / 3_600_000} hours`;

// How long an operation's log may go unwritten before this panel stops treating it as evidence that the
// deploy is still being reported on. Why a log at all: an operation's log has exactly one writer — the
// panel that spawned the deploy, which pipes the child's output into it (see deploy-store's
// `launchDetachedDeploy`) — so a log written to recently is that panel alive with a deploy still
// producing output, which is the one piece of evidence a panel that cannot see the process table can
// still get. Why not shorter: a docker build step produces no output for minutes while working, and
// reading that silence as an end is what reverts a live deploy's configuration. Why it bounds the
// deferral rather than proving liveness: once the output stops for this long the deferral ends, so no
// record can hold the deploy guard indefinitely through it.
export const DEPLOY_LOG_ACTIVITY_MS = 30 * 60_000;

// How long a claimed outcome's effects may stay unapplied before another settler may take them over.
// Why a lease and not "unapplied means crashed": the winner of the claim performs the effects (a
// config write, a config sync, an activation, a webhook) in the same call that claimed, so an
// unapplied claim is either a settler that is mid-effect or one that never came back, and only the
// clock can separate the two. The effects are seconds of work, which makes this ~30x margin.
export const DEPLOY_EFFECT_LEASE_MS = 5 * 60_000;

export const DEPLOY_TAIL_LENGTH = 4000;

export const DEPLOY_POLL_MS = 1000;

export const DEPLOY_HEARTBEAT_MS = 15_000;

// How often a mounted panel re-checks whether an operation is waiting for it. Repeating the lookup is
// what lets a panel that is already open settle — and announce — a deploy that finished while this
// tab was not watching it (another tab's deploy, or one whose watch the panel released).
export const DEPLOY_DISCOVERY_INTERVAL_MS = 30_000;

export const DEPLOY_OPERATION_ID_REGEX = /^[0-9a-f]{16}$/;
