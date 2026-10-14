const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Prefixes a root-absolute panel URL with the deployment's base path.
 *
 * Why this exists: `basePath` covers the routes Next renders and the links it owns, but a
 * URL the panel hands to `fetch`, `EventSource`, a plain `href`, or `next/image` reaches the
 * browser as written. Empty `NEXT_PUBLIC_BASE_PATH` — the root deployment — returns the path
 * unchanged, so this is a no-op everywhere the panel is served from the host root.
 */
export function withBasePath(path: string): string {
  if (BASE_PATH === '' || !path.startsWith('/')) return path;
  return `${BASE_PATH}${path}`;
}
