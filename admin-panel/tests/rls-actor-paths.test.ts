import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The path inventory, as a gate.
 *
 * WHY this is a test and not a paragraph in a register: enforcement moved from "the connection may
 * do anything" to "the connection may do what its actor may do", so a new module that reaches the
 * database by another route silently loses every row it expected. The failure is invisible — an
 * empty list, not an error — which is exactly the class of bug a written inventory does not
 * prevent. So the exceptions are pinned here by count and by file, and adding one fails.
 *
 * What is NOT pinned, because it cannot be: that a given request-scoped module establishes a
 * scope. It does not have to — `requireDbActor()` derives the actor from the session cookie for the
 * request, and a module that reaches Postgres outside a request and outside a scope raises rather
 * than reading everything. That property is proved in tests/rls-actor.test.ts and, against a real
 * database, in tests/test_rls_actor_enforcement.sh.
 */

const PANEL_ROOT = path.resolve(__dirname, '..');
const SRC = path.join(PANEL_ROOT, 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const SOURCE_FILES = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));

/**
 * The entry points that run OUTSIDE a request: seeding, migrations, the CLI and the waiver
 * export. They are the ones a request-scoped actor can never resolve for, so each has to name an
 * identity itself — and the inventory above, which walks `src`, cannot see them.
 */
const ENTRY_DIRS = [path.join(PANEL_ROOT, 'prisma'), path.join(PANEL_ROOT, 'scripts')];
const ENTRY_FILES = ENTRY_DIRS.flatMap((dir) => walk(dir)).filter((f) => /\.(ts|mjs)$/.test(f));

/**
 * Does this file reach the database, directly or through the modules it imports?
 *
 * Follows local `@/…` imports breadth-first, up to `depth` levels, and answers true on the first
 * hit of the one module that owns the client. A depth limit keeps a cyclic import graph finite; the
 * chains that matter here are one or two hops (entry point → store → client).
 */
function reachesPrisma(file: string, depth: number): boolean {
  const seen = new Set<string>();
  const queue: Array<{ file: string; depth: number }> = [{ file, depth }];
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || seen.has(next.file)) continue;
    seen.add(next.file);
    const text = fs.readFileSync(next.file, 'utf8');
    if (/from '@\/lib\/prisma'|from "@\/lib\/prisma"/.test(text)) return true;
    if (next.depth === 0) continue;
    for (const spec of text.matchAll(/from '(@\/[^']+)'/g)) {
      const resolved = resolveAlias(spec[1]);
      if (resolved) queue.push({ file: resolved, depth: next.depth - 1 });
      if (resolved && /^src\/lib\/prisma\.ts$/.test(path.relative(PANEL_ROOT, resolved).split(path.sep).join('/'))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Source with its comments removed.
 *
 * WHY: the assertion below looks for a CALL, and a comment that mentions the helper ("wrap the query in
 * withActor()") satisfies a bare pattern and turns the gate into a pass that proves nothing. Measured —
 * the very file that motivated the reachability walk passed on its own explanatory comment. Matching the
 * de-commented text is the honest form: block and line comments out, code left exactly as written.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** `@/lib/x` → the file on disk, trying the extensionless and index forms tsconfig allows. */
function resolveAlias(spec: string): string | null {
  const base = path.join(SRC, spec.replace(/^@\//, ''));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function relative(file: string): string {
  return path.relative(PANEL_ROOT, file).split(path.sep).join('/');
}

function filesMatching(needle: string): string[] {
  return SOURCE_FILES.filter((f) => fs.readFileSync(f, 'utf8').includes(needle)).map(relative).sort();
}

describe('every database path is accounted for', () => {
  it('has exactly one module that constructs the client', () => {
    // A second `new PrismaClient(...)` would be a second pool AND a client this wrapper does not
    // see, so its statements would carry no actor and read nothing — or, before this change, carry
    // no actor and read everything. Both are worth failing on.
    const constructors = filesMatching('new PrismaClient(');
    expect(constructors).toEqual(['src/lib/prisma.ts']);
  });

  it('takes the client from the wrapper everywhere, never a hand-rolled instance', () => {
    // Importing Prisma TYPES from @prisma/client is fine and widespread; what matters is that no
    // module holds an instance of its own. A second `new PrismaClient(...)` would be a second pool
    // AND a client this wrapper does not see, so its statements would carry no actor.
    const constructors = filesMatching('new PrismaClient(');
    expect(constructors).toEqual(['src/lib/prisma.ts']);
  });

  it('writes the actor only through set_config with is_local, never a session SET', () => {
    // WHY the negative matters as much as the positive: `SET cms.actor = ...` (no LOCAL) would
    // survive COMMIT on a pooled connection and hand the next request that connection's identity.
    // It is one keyword away, so it is the thing worth forbidding explicitly.
    const sessionScope = SOURCE_FILES.filter((f) => {
      const text = fs.readFileSync(f, 'utf8');
      return /SET\s+cms\.actor/i.test(text) || /set_config\(\s*'cms\.actor'\s*,[^)]*,\s*false/.test(text);
    }).map(relative);
    expect(sessionScope).toEqual([]);
  });

  it('keeps the pre-session identity to the two credential paths', () => {
    const auth = filesMatching('SYSTEM_IDENTITIES.AUTH');
    expect(auth).toEqual(['src/app/actions/auth.ts', 'src/lib/auth.ts']);
  });

  it('keeps the ingest identity to the feed endpoint', () => {
    expect(filesMatching('SYSTEM_IDENTITIES.INGEST')).toEqual([
      'src/app/api/security/findings/route.ts',
    ]);
  });

  it('keeps the CLI identity to the CLI entry point', () => {
    expect(filesMatching('SYSTEM_IDENTITIES.CLI')).toEqual(['src/cli/main.ts']);
  });

  it('never reaches for the unwrapped client from an app path', () => {
    // `prismaUnscoped` exists for an entry point that must ESTABLISH an identity. Nothing under the
    // App Router may use it: a route that did would run with whatever actor happened to be set, and
    // the whole point is that a route's identity comes from its session.
    const offenders = SOURCE_FILES.filter(
      (f) => f.startsWith(path.join(SRC, 'app')) && fs.readFileSync(f, 'utf8').includes('prismaUnscoped'),
    ).map(relative);
    expect(offenders).toEqual([]);
  });

  it('makes every out-of-request entry point name its identity', () => {
    // WHY: migration 20261025120000 puts FORCE RLS on every table, and FORCE applies to the owner
    // too. An entry point that queries the client without establishing an actor reaches the
    // request-scoped resolution, which imports next/headers outside a request — so the first
    // production seed died with MODULE_NOT_FOUND after the migrations had already run, leaving
    // every admin holding groups that grant nothing. Nothing compared the two facts, so nothing
    // could notice it before the deploy did.
    //
    // WHY reach is followed instead of the direct import: the entry points that broke in production
    // did not import the client themselves — `scripts/reconcile-exposures.ts` imported a store that
    // does, so a rule keyed on `from '@/lib/prisma'` read it as absent and passed while every tick
    // died with "no database actor" and the front kept a stale config. A reachability walk is the
    // property that actually matters: does this process end up at Postgres or not.
    const dbEntries = ENTRY_FILES.filter((f) => reachesPrisma(f, 3));
    expect(dbEntries.length).toBeGreaterThan(0);
    for (const file of dbEntries) {
      const text = fs.readFileSync(file, 'utf8');
      // The call, not the word: comments are stripped first (see `withoutComments`), and the argument
      // is deliberately not constrained — `withActor(VERIFY_ACTOR, …)` names a constant actor and is
      // just as correct as an inline object.
      expect(
        withoutComments(text),
        `${relative(file)} reaches the database but never establishes an actor`,
      ).toMatch(/withActor\(/);
    }
  });

  it('routes every server action and route handler through the one client', () => {
    // A cheap completeness check on the app tree: anything that talks to the database by name must
    // import the wrapper. The import is what makes the actor non-optional.
    const dbUsers = SOURCE_FILES.filter((f) => {
      if (!f.startsWith(path.join(SRC, 'app'))) return false;
      const text = fs.readFileSync(f, 'utf8');
      return /\bprisma\.[a-z_]+\.(find|create|update|delete|upsert|count|aggregate|groupBy)/.test(text);
    });
    expect(dbUsers.length).toBeGreaterThan(0);
    for (const file of dbUsers) {
      expect(fs.readFileSync(file, 'utf8'), `${relative(file)} uses prisma without the wrapper`).toMatch(
        /from '@\/lib\/prisma'|from "@\/lib\/prisma"/,
      );
    }
  });
});
