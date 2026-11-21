/** The path the proxy stamped on this request; a server action and a route handler are given none,
 *  and the actorless surface must tell an /api call from a page. The proxy overwrites any caller value. */
export const REQUEST_PATH_HEADER = 'x-cms-path';
