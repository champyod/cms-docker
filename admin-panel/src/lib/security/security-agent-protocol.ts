import { isIP } from 'node:net';

export const SECURITY_AGENT_DIR = '.security-agent';
export const SECURITY_AGENT_QUEUE_DIR = 'queue';
export const SECURITY_AGENT_RESULTS_DIR = 'results';
export const SECURITY_AGENT_STATE_FILE = 'fail2ban-state.json';
export const FAIL2BAN_JAIL_FILE = 'config/fail2ban/jail.d/grader.conf';

export const SECURITY_AGENT_ACTIONS = ['unban', 'renew-certs'] as const;
export const SECURITY_AGENT_JAIL_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export type SecurityAgentAction = (typeof SECURITY_AGENT_ACTIONS)[number];

export interface SecurityAgentRequest {
  readonly id: string;
  readonly action: SecurityAgentAction;
  readonly jail: string | null;
  readonly ip: string | null;
  readonly requestedBy: string;
  readonly reason: string;
  readonly requestedAt: string;
}

export interface RequestBuildResult {
  readonly request: SecurityAgentRequest | null;
  readonly errors: readonly string[];
}

export interface UnbanRequestInput {
  readonly id: string;
  readonly jail: string;
  readonly ip: string;
  readonly requestedBy: string;
  readonly reason: string;
  readonly knownJails: readonly string[];
  readonly requestedAt: string;
}

export interface RenewRequestInput {
  readonly id: string;
  readonly requestedBy: string;
  readonly reason: string;
  readonly requestedAt: string;
}

export interface Fail2banBan {
  readonly jail: string;
  readonly ip: string;
  readonly bannedAt: string | null;
  readonly expiresAt: string | null;
}

export interface Fail2banState {
  readonly updatedAt: string | null;
  readonly bans: readonly Fail2banBan[];
}

/** Jail names come from the tracked jail config, so the panel and the agent agree by construction. */
export function parseJailNames(content: string): readonly string[] {
  const names: string[] = [];
  for (const line of content.split('\n')) {
    const match = /^\[([A-Za-z0-9_-]+)\]\s*$/.exec(line);
    if (match !== null) names.push(match[1]);
  }
  return names;
}

export function isValidIpAddress(value: string): boolean {
  return isIP(value) !== 0;
}

function requestIdErrors(id: string): readonly string[] {
  return /^[a-zA-Z0-9-]{8,64}$/.test(id) ? [] : ['Request id must be 8-64 characters of letters, digits or dashes'];
}

export function buildUnbanRequest(input: UnbanRequestInput): RequestBuildResult {
  const errors = [
    ...requestIdErrors(input.id),
    ...(input.jail.trim().length === 0 ? ['A jail is required'] : []),
    ...(input.reason.trim().length === 0 ? ['A reason is required to unban an address'] : []),
    ...(isValidIpAddress(input.ip) ? [] : ['Not a valid IP address']),
  ];
  if (errors.length > 0) return { request: null, errors };
  if (!input.knownJails.includes(input.jail)) {
    return { request: null, errors: [`Unknown jail: ${input.jail}`] };
  }
  if (!SECURITY_AGENT_JAIL_PATTERN.test(input.jail)) {
    return { request: null, errors: [`Not a valid jail name: ${input.jail}`] };
  }
  return {
    request: {
      id: input.id,
      action: 'unban',
      jail: input.jail,
      ip: input.ip,
      requestedBy: input.requestedBy,
      reason: input.reason,
      requestedAt: input.requestedAt,
    },
    errors: [],
  };
}

export function buildRenewRequest(input: RenewRequestInput): RequestBuildResult {
  const errors = [
    ...requestIdErrors(input.id),
    ...(input.reason.trim().length === 0 ? ['A reason is required to renew certificates'] : []),
  ];
  if (errors.length > 0) return { request: null, errors };
  return {
    request: {
      id: input.id,
      action: 'renew-certs',
      jail: null,
      ip: null,
      requestedBy: input.requestedBy,
      reason: input.reason,
      requestedAt: input.requestedAt,
    },
    errors: [],
  };
}

export function serializeRequest(request: SecurityAgentRequest): string {
  return `${JSON.stringify(request, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readText(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

/** A missing or unparsable state file means "unknown", never "no bans". */
export function parseFail2banState(raw: string | null): Fail2banState | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.bans)) return null;
  const bans = parsed.bans.flatMap((entry): Fail2banBan[] => {
    if (!isRecord(entry)) return [];
    const jail = readText(entry, 'jail');
    const ip = readText(entry, 'ip');
    if (jail === null || ip === null || !isValidIpAddress(ip)) return [];
    return [{ jail, ip, bannedAt: readText(entry, 'bannedAt'), expiresAt: readText(entry, 'expiresAt') }];
  });
  return { updatedAt: readText(parsed, 'updatedAt'), bans };
}
