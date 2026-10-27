import { BARE_CALL_RE, ROUTE_GATE_RE, type FileInfo } from "./model";

// The two shapes a page branches on a permission before it reads: the engine helper and the
// effective-permission set the route gate handed it.
const GUARD_RE = /(?:hasEffectivePermission\s*\(\s*\w+\s*,\s*|\.has\s*\(\s*)'([^']+)'/g;

/** One read a page performs, named by its action id (`<file>#<fn>`), with the keys it refuses without. */
export interface PageRead {
  action: string;
  keys: readonly string[];
}

export interface PageScopeFinding {
  page: string;
  routeId: string;
  read: PageRead;
}

/**
 * The route id a page authorizes through, or null when it gates another way.
 *
 * Only `authorizeRoutePage` is read because that is the descriptor link; a page
 * that gates with a bare `ensurePermission` enforces its own key and has no
 * descriptor requirements to fall out of step with.
 */
export function pageRouteId(page: FileInfo): string | null {
  ROUTE_GATE_RE.lastIndex = 0;
  const match = ROUTE_GATE_RE.exec(page.source);
  return match === null ? null : match[1];
}

/**
 * The actions a page calls, resolved through its own imports.
 *
 * One hop only: this reads what the page hands to a server action. A read hidden
 * behind a second helper is invisible here, which is why the pages all call
 * their reads directly rather than through a wrapper.
 */
export function pageReads(
  page: FileInfo,
  actionKeys: ReadonlyMap<string, readonly string[]>,
): readonly PageRead[] {
  const reads: PageRead[] = [];
  const seen = new Set<string>();
  BARE_CALL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BARE_CALL_RE.exec(page.source)) !== null) {
    const action = page.namedImports.get(match[1]);
    if (action === undefined || seen.has(action)) continue;
    const keys = actionKeys.get(action);
    if (keys === undefined || keys.length === 0) continue;
    seen.add(action);
    reads.push({ action, keys });
  }
  return reads;
}

/**
 * The keys a descriptor promises its reader, which are the `all` ones.
 *
 * A key in `any` is a key the reader *may* hold, so a page that calls a read
 * needing it can still refuse a reader who holds the other alternative.
 */
export function grantedKeys(requirement: {
  all?: readonly string[];
  any?: readonly string[];
}): readonly string[] {
  return requirement.all ?? [];
}

/**
 * The keys a page asks about before it reads: the shape `effective.has('k')` and
 * `hasEffectivePermission(x, 'k')` take, with comments removed so a key named in
 * prose cannot pass for a guard. A page that guards a read this way never starts
 * it for a reader who lacks the key, which is the other way a page may read
 * beyond its gate.
 */
export function guardedKeys(page: FileInfo): ReadonlySet<string> {
  const code = page.source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const keys = new Set<string>();
  for (const match of code.matchAll(GUARD_RE)) keys.add(match[1]);
  return keys;
}

/** The reads a page performs that its route gate never granted and its own code never guarded. */
export function ungrantedReads(
  reads: readonly PageRead[],
  granted: readonly string[],
  guarded: ReadonlySet<string> = new Set<string>(),
): readonly PageRead[] {
  const allowed = new Set([...granted, ...guarded]);
  return reads.filter((read) => read.keys.some((key) => !allowed.has(key)));
}
