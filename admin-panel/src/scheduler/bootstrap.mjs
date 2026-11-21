// Process entry point for the scheduler image. `tsc` emits the `@/` path-alias
// specifier verbatim, so the compiled tree needs that alias resolved before its
// first load; node reads no tsconfig of its own, and the poller ships as
// compiled CommonJS rather than a bundle.
//
// The compiled tree is CommonJS, so an ESM entry point reaches it through
// createRequire, and the alias is resolved for `require` by the resolver the CJS
// loader already consults for every module it loads.
//
// WHY the first argument selects the entry: one image now carries two long-lived
// processes — the backup scheduler (`scheduler` in docker-compose.yml) and the
// security signal (`security-signal` in docker-compose.security.yml) — and they
// must run the same compiled read path, not two copies of it. The map is a
// closed allowlist rather than a path built from argv, so a typo cannot load
// some other module; no argument keeps the original behaviour exactly.
import { createRequire, Module } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const loadCompiled = createRequire(import.meta.url);
const resolveFilename = Module._resolveFilename;

const ENTRIES = new Map([
  ['scheduler', 'main'],
  ['security-signal', 'security-signal'],
]);

const requested = process.argv[2] ?? 'scheduler';
const entry = ENTRIES.get(requested);
if (entry === undefined) {
  console.error(`bootstrap: unknown entry ${JSON.stringify(requested)}; expected one of ${[...ENTRIES.keys()].join(', ')}`);
  process.exit(2);
}

Module._resolveFilename = function resolveSchedulerAlias(request, ...rest) {
  if (!request.startsWith('@/')) return resolveFilename.call(this, request, ...rest);
  return resolveFilename.call(this, path.join(DIST_ROOT, `${request.slice(2)}.js`), ...rest);
};

loadCompiled(path.join(DIST_ROOT, 'scheduler', `${entry}.js`));

