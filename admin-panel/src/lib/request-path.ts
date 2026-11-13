/**
 * The header the proxy stamps on every request with the path it was served at.
 *
 * WHY it exists: Next hands a server action and a route handler no URL of their own, and the
 * actorless surface has to tell an /api call (which must answer 401) from a page render or an
 * action (which must be redirected to the login). The proxy is the last place that still knows the
 * path, so it says so on the way through. A caller-supplied value cannot win: the proxy overwrites
 * it on every path it matches.
 */
export const REQUEST_PATH_HEADER = 'x-cms-path';
