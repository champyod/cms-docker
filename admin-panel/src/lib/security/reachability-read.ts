// Kernel CVE reachability on the read path: the recorded host module state, and the SQL mirror of it.
import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { moduleStateMap } from '@/lib/security/host-module-state';
import {
  classifyReachability,
  SUBSYSTEM_MODULES,
  type HostModuleState,
  type Reachability,
  type SubsystemRule,
} from '@/lib/security/kernel-reachability';
import type { PatchingReachabilityFilter } from '@/lib/security/patching';

/** One recorded state per host, keyed by the host string a finding carries. */
export type HostModuleStates = ReadonlyMap<string, HostModuleState>;

type TokenRule = readonly [token: string, rule: SubsystemRule];

// Every module any rule names: `moduleStateMap` then answers for all of them, never `undefined`.
const RULE_MODULES: readonly string[] = [
  ...new Set(Object.values(SUBSYSTEM_MODULES).flatMap((rule) => rule.modules)),
];

const TOKEN_RULES = Object.entries(SUBSYSTEM_MODULES) as TokenRule[];

// The one fact the SQL cannot derive from a report: code compiled into every supported kernel.
const BUILT_IN_TOKENS: readonly string[] = TOKEN_RULES.filter(([, rule]) => rule.builtIn).map(
  ([token]) => token,
);

const MODULE_TOKENS: readonly TokenRule[] = TOKEN_RULES.filter(([, rule]) => !rule.builtIn);

/**
 * The recorded module state of every host, in one query.
 *
 * WHY not per row: a page holds 25 findings and at most a handful of hosts, so the state is read
 * once and classified in memory — a query per row would re-read the same one or two rows 25 times.
 */
export async function readHostModuleStates(): Promise<HostModuleStates> {
  const rows = await prisma.security_host_modules.findMany({
    select: { host: true, loaded: true, blocked: true },
  });
  return new Map(rows.map((row) => [row.host, moduleStateMap(RULE_MODULES, row)]));
}

/** The verdict for one finding: its title, plus the state recorded for its own host. */
export function reachabilityFor(
  title: string | null,
  host: string | null,
  states: HostModuleStates,
): Reachability {
  const state = host === null ? undefined : states.get(host);
  return classifyReachability(title ?? '', state ?? {});
}

// The title prefixes naming one subsystem: the parser accepts the space after `kernel:` and not.
function titleClauses(token: string): Prisma.security_findingsWhereInput[] {
  return [`kernel: ${token}:`, `kernel:${token}:`].map((prefix) => ({
    title: { startsWith: prefix, mode: 'insensitive' as const },
  }));
}

// A subsystem whose code runs on that host: one of its modules is listed in /proc/modules.
function loadedTokens(state: HostModuleState): readonly string[] {
  return MODULE_TOKENS.filter(([, rule]) =>
    rule.modules.some((name) => state[name] === 'loaded'),
  ).map(([token]) => token);
}

// Reported and absent or blacklisted: every module it needs, none of them running.
function unloadedTokens(state: HostModuleState): readonly string[] {
  const loaded = new Set(loadedTokens(state));
  return MODULE_TOKENS.filter(([token]) => !loaded.has(token)).map(([token]) => token);
}

// Per-host clauses; a host with no token in that verdict contributes no rows to it.
function hostClauses(
  states: HostModuleStates,
  tokensOf: (state: HostModuleState) => readonly string[],
): Prisma.security_findingsWhereInput[] {
  const clauses: Prisma.security_findingsWhereInput[] = [];
  for (const [host, state] of states) {
    const tokens = tokensOf(state);
    if (tokens.length > 0) clauses.push({ host, OR: tokens.flatMap(titleClauses) });
  }
  return clauses;
}

// An empty OR matches no row; a filter that matched nothing must not read as one that matched all.
function orNothing(clauses: Prisma.security_findingsWhereInput[]): Prisma.security_findingsWhereInput {
  return clauses.length === 0 ? { id: { in: [] } } : { OR: clauses };
}

/**
 * The SQL predicate for a reachability filter, or null for 'all'.
 *
 * WHY it mirrors `classifyReachability` clause for clause: the page renders the verdict computed in
 * JavaScript, so a filter that disagreed would show a badge the reader did not ask for. It can only
 * diverge on a title whose `kernel: <subsystem>:` prefix is not the shape the producer writes, and
 * such a title is 'unknown' either way.
 *
 * WHY the null branches on 'unknown': a NULL column makes the negated clause NULL, not true, so the
 * rows with no title or no host must be named — they are exactly the unanswered ones.
 */
export function reachabilityWhere(
  filter: PatchingReachabilityFilter,
  states: HostModuleStates,
): Prisma.security_findingsWhereInput | null {
  if (filter === 'all') return null;
  const reachable = [...BUILT_IN_TOKENS.flatMap(titleClauses), ...hostClauses(states, loadedTokens)];
  const unreachable = hostClauses(states, unloadedTokens);
  if (filter === 'reachable') return orNothing(reachable);
  if (filter === 'unreachable') return orNothing(unreachable);
  const known = [...reachable, ...unreachable];
  return { OR: [{ title: null }, { host: null }, { NOT: { OR: known } }] };
}
