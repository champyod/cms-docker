/**
 * Renders a resolved route set into the two artifacts a deployment needs: the
 * nginx server blocks and the tailnet serve config for the exposed names.
 *
 * WHY validation lives here: every value interpolated below comes from the
 * database, so this module is the boundary where operator input becomes running
 * configuration. A newline or a brace reaching nginx is a config injection, and a
 * hostname reaching serve.json decides a certificate boundary. Both are rejected
 * rather than escaped: a value that needs escaping was never a hostname.
 */
import type { Route } from './service-wiring';

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderError';
  }
}

const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
// A tailscale node name also becomes a config file name, so it stays a single DNS label.
const TAILNET_NODE_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const PATH_PATTERN = /^\/[A-Za-z0-9._~\-/]*$/;
const TLS_LISTEN_PORT = 443;
const PLAIN_LISTEN_PORT = 80;
const TS_CERT_DOMAIN_PLACEHOLDER = '${TS_CERT_DOMAIN}';

/**
 * Where a TLS server block gets its certificate.
 *
 * WHY this is a parameter and not a constant: two fronts terminate here with
 * different layouts. The contest proxy keeps a pair under /etc/nginx/ssl, while the
 * domain proxy reads a certbot lineage under /etc/letsencrypt/live plus a shared ssl
 * parameter file. Hard-coding either one makes the other refuse to start.
 */
export interface CertificateSpec {
  certificate: string;
  key: string;
  sslInclude?: string;
}

export const CONTEST_PROXY_CERTIFICATE: CertificateSpec = {
  certificate: '/etc/nginx/ssl/cert.pem',
  key: '/etc/nginx/ssl/key.pem',
};

/**
 * A hostname is only ever a lower-case DNS name: no scheme, no port, no wildcard,
 * no underscore, no trailing dot, so it cannot carry a directive into the file.
 */
export function assertSafeHostname(hostname: string): string {
  const value = hostname.trim().toLowerCase();
  if (!HOSTNAME_PATTERN.test(value) || value.includes('..')) {
    throw new RenderError(`unsafe hostname: ${JSON.stringify(hostname)}`);
  }
  return value;
}

/**
 * A certificate or include path is sent to nginx verbatim, so it is held to the same
 * rule as a path: no quote, semicolon, brace or whitespace can reach the directive.
 */
export function assertSafeIncludePath(path: string): string {
  const CONFIG_PATH_PATTERN = /^\/[A-Za-z0-9._~\-/]+$/;
  if (!CONFIG_PATH_PATTERN.test(path)) {
    throw new RenderError(`unsafe config path: ${JSON.stringify(path)}`);
  }
  return path;
}

/** Single quotes, semicolons and whitespace are absent by construction, so no escape hatch exists. */
export function assertSafePath(path: string): string {
  if (!PATH_PATTERN.test(path)) {
    throw new RenderError(`unsafe path: ${JSON.stringify(path)}`);
  }
  return path;
}

/** The registrable apex: two labels back for a normal FQDN, the whole name when shorter. */
export function certificateLineage(hostname: string): string {
  const labels = assertSafeHostname(hostname).split('.');
  return labels.length <= 2 ? labels.join('.') : labels.slice(-2).join('.');
}

/** A non-root prefix proxies with a trailing slash so nginx strips it before the app sees it. */
function proxyPassLine(path: string, upstream: string): string {
  const target = path === '/' ? upstream : `${upstream}/`;
  return `        proxy_pass http://${target};`;
}

// The upstream a generated route forwards to must see the same client identity and scheme
// the curated vhosts pass, or the panel behind it reads every request as the proxy's own.
const PROXY_FORWARD_HEADERS = [
  'proxy_set_header Host $host;',
  'proxy_set_header X-Real-IP $remote_addr;',
  'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
  'proxy_set_header X-Forwarded-Proto $scheme;',
];

// Matching the curated vhosts: a location that declares any add_header drops every
// server-level one, so each generated location re-declares the front's HSTS.
const LOCATION_SECURITY_HEADERS = [
  'add_header Strict-Transport-Security "max-age=300; includeSubDomains" always;',
];

function renderServerBlock(hostname: string, routes: Route[], certificate: CertificateSpec): string {
  const name = assertSafeHostname(hostname);
  const lines = ['server {', `    listen ${routes[0].tls ? `${TLS_LISTEN_PORT} ssl` : `${PLAIN_LISTEN_PORT}`};`, `    server_name ${name};`];
  for (const header of PROXY_FORWARD_HEADERS) lines.push(`    ${header}`);
  if (routes[0].tls) {
    lines.push(`    ssl_certificate ${assertSafeIncludePath(certificate.certificate)};`);
    lines.push(`    ssl_certificate_key ${assertSafeIncludePath(certificate.key)};`);
    if (certificate.sslInclude !== undefined) {
      lines.push(`    include ${assertSafeIncludePath(certificate.sslInclude)};`);
    }
  }
  for (const route of routes) lines.push(...locationLines(route));
  lines.push('}');
  return lines.join('\n');
}

/** The location block for one route: `/` owns the root, a prefix strips and redirects into it. */
function locationLines(route: Route): string[] {
  const path = assertSafePath(route.path);
  const security = LOCATION_SECURITY_HEADERS.map((header) => `        ${header}`);
  if (path === '/') {
    return ['    location / {', proxyPassLine(path, route.upstream), ...security, '    }'];
  }
  return [
    `    location = ${path} {`,
    `        return 301 ${path}/;`,
    '    }',
    `    location ^~ ${path}/ {`,
    proxyPassLine(path, route.upstream),
    ...security,
    '    }',
  ];
}

/**
 * One server block per hostname, its root owner first and every path exposure a location
 * inside it. WHY grouped: a path exposure joins its hostname's vhost rather than opening a
 * second block for the same name, so one vhost per name still gets the front's certificate
 * and headers, and a shorter prefix cannot win over a longer one.
 *
 * WHY a fragment route is skipped: its hostname is one the front already serves, so the listener,
 * the server_name and the certificate are that vhost's — and a second block for the same name is
 * the very thing nginx discards. Its locations go to `renderLocationFragments` instead.
 */
export function renderNginxServers(
  routes: Route[],
  certificate: CertificateSpec = CONTEST_PROXY_CERTIFICATE
): string {
  const byHostname = new Map<string, Route[]>();
  for (const route of routes) {
    if (route.fragmentLabel !== null) continue;
    const hostname = assertSafeHostname(route.hostname);
    byHostname.set(hostname, [...(byHostname.get(hostname) ?? []), route]);
  }
  const blocks: string[] = [];
  for (const [hostname, group] of byHostname) {
    const owners = group.filter((route) => assertSafePath(route.path) === '/');
    const prefixes = group.filter((route) => assertSafePath(route.path) !== '/');
    blocks.push(renderServerBlock(hostname, [...owners, ...prefixes], certificate));
  }
  return blocks.join('\n\n');
}

/**
 * The locations a registry exposure adds to the front's own vhost, as the lines that vhost includes.
 *
 * WHY locations only, and only for one label: the include sits inside a block that already declares
 * the listener, the server_name, the certificate and the front's headers, so a `server`, a `listen`
 * or a certificate line here would either be rejected or silently change which vhost answers.
 */
export function renderLocationFragments(routes: Route[], label: string): string {
  return routes
    .filter((route) => route.fragmentLabel === label)
    .map((route) => locationLines(route).join('\n'))
    .join('\n');
}

/**
 * A tailnet node name, held to one DNS label.
 *
 * WHY this is validated and not merely trimmed: the name names a container and a file
 * on disk, so `../..` in this field would be a path traversal out of the generated
 * directory, and a name carrying a slash would write somewhere nobody chose.
 */
export function assertSafeTailnetNode(node: string): string {
  const value = node.trim();
  if (!TAILNET_NODE_PATTERN.test(value)) {
    throw new RenderError(`unsafe tailnet node: ${JSON.stringify(node)}`);
  }
  return value;
}

/**
 * One serve config per tailnet node.
 *
 * WHY grouped: each exposed contest gets its own tailscale container, and a container
 * reads exactly one serve config. One file for every name would have every container
 * claim every contest, which is the opposite of per-contest exposure.
 */
export function renderServeConfigs(routes: Route[]): Map<string, string> {
  const byNode = new Map<string, Route[]>();
  for (const route of routes) {
    if (route.tailnet === null || route.tailnet.trim() === '') continue;
    const node = assertSafeTailnetNode(route.tailnet);
    const path = assertSafePath(route.path);
    const nodeRoutes = byNode.get(node) ?? [];
    if (nodeRoutes.some((existing) => assertSafePath(existing.path) === path)) {
      throw new RenderError(`node ${node} serves two contests on ${path}`);
    }
    nodeRoutes.push(route);
    byNode.set(node, nodeRoutes);
  }
  const rendered = new Map<string, string>();
  for (const [node, nodeRoutes] of byNode) rendered.set(node, renderServeConfig(nodeRoutes));
  return rendered;
}

/**
 * One node's tailnet serve config. WHY the placeholder and not a literal hostname:
 * tailscaled substitutes TS_CERT_DOMAIN with its own node certificate domain, so the
 * file stays identical across hosts and no hostname is baked into git.
 */
export function renderServeConfig(routes: Route[]): string {
  const served = routes.filter((route) => route.tailnet !== null && route.tailnet.trim() !== '');
  if (served.length === 0) return '';
  const handlers: Record<string, { Proxy: string }> = {};
  for (const route of served) {
    handlers[assertSafePath(route.path)] = { Proxy: `http://${route.upstream}` };
  }
  const key = `${TS_CERT_DOMAIN_PLACEHOLDER}:443`;
  return JSON.stringify(
    { TCP: { '443': { HTTPS: true } }, Web: { [key]: { Handlers: handlers } }, AllowFunnel: { [key]: true } },
    null,
    2
  );
}
