export const DEPLOY_IDLE_TIMEOUT_MS = 5 * 60_000;

// Absolute ceiling from operation start; idle timeout above can never fire past this.
export const DEPLOY_WALL_TIMEOUT_MS = 15 * 60_000;

export const DEPLOY_STALE_MS = 30 * 60 * 1000;

export const DEPLOY_TAIL_LENGTH = 4000;

export const DEPLOY_POLL_MS = 1000;

export const DEPLOY_HEARTBEAT_MS = 15_000;

export const DEPLOY_OPERATION_ID_REGEX = /^[0-9a-f]{16}$/;
