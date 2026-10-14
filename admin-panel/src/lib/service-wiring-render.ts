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

function renderNginxServer(route: Route, certificate: CertificateSpec): string {
  const hostname = assertSafeHostname(route.hostname);
  const path = assertSafePath(route.path);
  const listen = route.tls ? `${TLS_LISTEN_PORT} ssl` : `${PLAIN_LISTEN_PORT}`;
  const lines = ['server {', `    listen ${listen};`, `    server_name ${hostname};`];
  if (route.tls) {
    lines.push(`    ssl_certificate ${assertSafeIncludePath(certificate.certificate)};`);
    lines.push(`    ssl_certificate_key ${assertSafeIncludePath(certificate.key)};`);
    if (certificate.sslInclude !== undefined) {
      lines.push(`    include ${assertSafeIncludePath(certificate.sslInclude)};`);
    }
  }
  if (path === '/') {
    lines.push('    location / {', proxyPassLine(path, route.upstream), '    }');
  } else {
    lines.push(`    location = ${path} {`, `        return 301 ${path}/;`, '    }');
    lines.push(`    location ^~ ${path}/ {`, proxyPassLine(path, route.upstream), '    }');
  }
  lines.push('}');
  return lines.join('\n');
}

/**
 * One server block per route. A non-root path is matched with ^~ so a shorter
 * prefix cannot win over a longer one, and the bare prefix redirects into it.
 */
export function renderNginxServers(
  routes: Route[],
  certificate: CertificateSpec = CONTEST_PROXY_CERTIFICATE
): string {
  return routes.map((route) => renderNginxServer(route, certificate)).join('\n\n');
}

/**
 * The tailnet serve config. WHY the placeholder and not a literal hostname:
 * tailscaled substitutes TS_CERT_DOMAIN with its own node certificate domain, so
 * the file stays identical across hosts and no hostname is baked into git.
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
