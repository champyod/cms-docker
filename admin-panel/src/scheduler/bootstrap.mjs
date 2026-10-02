// Process entry point for the scheduler image. `tsc` emits the `@/` path-alias
// specifier verbatim, so the compiled tree needs that alias resolved before its
// first load; node reads no tsconfig of its own, and the poller ships as
// compiled CommonJS rather than a bundle.
//
// The compiled tree is CommonJS, so an ESM entry point reaches it through
// createRequire, and the alias is resolved for `require` by the resolver the CJS
// loader already consults for every module it loads.
import { createRequire, Module } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const loadCompiled = createRequire(import.meta.url);
const resolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveSchedulerAlias(request, ...rest) {
  if (!request.startsWith('@/')) return resolveFilename.call(this, request, ...rest);
  return resolveFilename.call(this, path.join(DIST_ROOT, `${request.slice(2)}.js`), ...rest);
};

loadCompiled(path.join(DIST_ROOT, 'scheduler', 'main.js'));
