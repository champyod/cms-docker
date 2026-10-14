import { describe, expect, it } from 'vitest';

import {
  exposureRoutes,
  normalisePath,
  resolveWirings,
  servicesForContest,
  WiringError,
  type ExposureRow,
  type ServiceRow,
  type WiringRow,
} from '@/lib/service-wiring';
import {
  parseCertificate,
  parsePayload,
  renderFromPayload,
  type WiringPayload,
} from '@/lib/service-wiring-cli';
import {
  assertSafeIncludePath,
  assertSafeHostname,
  assertSafePath,
  certificateLineage,
  CONTEST_PROXY_CERTIFICATE,
  renderNginxServers,
  renderServeConfig,
  RenderError,
} from '@/lib/service-wiring-render';

function service(overrides: Partial<ServiceRow> & Pick<ServiceRow, 'id' | 'name'>): ServiceRow {
  return {
    role: 'ContestWebServer',
    shard: 0,
    host: overrides.name,
    http_port: 8888,
    rpc_port: 21000,
    db_profile: 'default',
    contest_id: null,
    enabled: true,
    ...overrides,
  };
}

function exposure(overrides: Partial<ExposureRow> & Pick<ExposureRow, 'contest_id'>): ExposureRow {
  return { hostname: 'a.example.com', path: '/', tls: true, tailnet: null, ...overrides };
}

describe('normalisePath', () => {
  it.each([
    ['/', '/'],
    ['', '/'],
    ['   ', '/'],
    ['beta', '/beta'],
    ['/beta', '/beta'],
    ['beta/', '/beta'],
    ['/beta/', '/beta'],
    ['/a/b/', '/a/b'],
  ])('turns %j into %j', (input, expected) => {
    expect(normalisePath(input)).toBe(expected);
  });
});

describe('resolveWirings', () => {
  const evaluation = service({ id: 1, name: 'cms-evaluation-service', role: 'EvaluationService' });
  const worker = service({ id: 2, name: 'cms-worker-0', role: 'Worker' });

  it('joins both endpoints', () => {
    const wirings: WiringRow[] = [
      { from_service_id: 1, to_service_id: 2, relation: 'drains', enabled: true },
    ];
    expect(resolveWirings([evaluation, worker], wirings)).toEqual([
      { from: evaluation, to: worker, relation: 'drains' },
    ]);
  });

  it('drops disabled links', () => {
    const wirings: WiringRow[] = [
      { from_service_id: 1, to_service_id: 2, relation: 'drains', enabled: false },
    ];
    expect(resolveWirings([evaluation, worker], wirings)).toEqual([]);
  });

  it('fails loudly on an unregistered endpoint, even when disabled', () => {
    const wirings: WiringRow[] = [
      { from_service_id: 1, to_service_id: 99, relation: 'drains', enabled: false },
    ];
    expect(() => resolveWirings([evaluation], wirings)).toThrow(WiringError);
  });
});

describe('servicesForContest', () => {
  const bound = service({ id: 1, name: 'cms-contest-web-server-1', contest_id: 1 });
  const other = service({ id: 2, name: 'cms-contest-web-server-2', contest_id: 2 });
  const shared = service({ id: 3, name: 'cms-evaluation-service', role: 'EvaluationService' });
  const off = service({ id: 4, name: 'cms-worker-0', role: 'Worker', enabled: false });

  it('returns the bound and the shared, never another contest or a disabled row', () => {
    expect(servicesForContest(1, [bound, other, shared, off]).map((s) => s.id)).toEqual([1, 3]);
  });
});

describe('exposureRoutes', () => {
  it('prefers the contest-bound server over the shared one', () => {
    const shared = service({ id: 1, name: 'cms-contest-web-server', host: 'shared' });
    const own = service({ id: 2, name: 'cms-contest-web-server-3', host: 'own', contest_id: 3 });
    expect(exposureRoutes([exposure({ contest_id: 3 })], [shared, own])[0].upstream).toBe('own:8888');
  });

  it('breaks a tie on the lowest shard', () => {
    const high = service({ id: 1, name: 'w-high', host: 'high', shard: 4, contest_id: 9 });
    const low = service({ id: 2, name: 'w-low', host: 'low', shard: 1, contest_id: 9 });
    expect(exposureRoutes([exposure({ contest_id: 9 })], [high, low])[0].upstream).toBe('low:8888');
  });

  it('fails when a contest has nothing to answer on', () => {
    expect(() => exposureRoutes([exposure({ contest_id: 9 })], [])).toThrow(WiringError);
  });

it('refuses to proxy to a server with no http port', () => {
    const noHttp = service({ id: 1, name: 'web-x', host: 'web-x', contest_id: 4, http_port: null });
    expect(() => exposureRoutes([exposure({ contest_id: 4 })], [noHttp])).toThrow(/http_port/);
  });

  it('normalises the path it carries through', () => {
    const own = service({ id: 1, name: 'w', contest_id: 2 });
    expect(exposureRoutes([exposure({ contest_id: 2, path: 'beta/' })], [own])[0].path).toBe('/beta');
  });
});

describe('renderNginxServers', () => {
  const route = {
    contest_id: 1,
    hostname: 'a.example.com',
    path: '/',
    upstream: 'web-1:8888',
    tls: true,
    tailnet: null,
  };

  it('renders a TLS server block for the apex path', () => {
    const out = renderNginxServers([route]);
    expect(out).toContain('listen 443 ssl;');
    expect(out).toContain('server_name a.example.com;');
    expect(out).toContain('proxy_pass http://web-1:8888;');
  });

  it('renders a prefix block that strips the prefix and redirects the bare form', () => {
    const out = renderNginxServers([{ ...route, path: '/beta' }]);
    expect(out).toContain('location ^~ /beta/ {');
    expect(out).toContain('proxy_pass http://web-1:8888/;');
    expect(out).toContain('return 301 /beta/;');
  });

  it('refuses a hostname that could inject a directive', () => {
    const hostile = { ...route, hostname: 'a.example.com; root /etc;' };
    expect(() => renderNginxServers([hostile])).toThrow(RenderError);
  });

  it('refuses a path that could inject a location', () => {
    expect(() => assertSafePath('/beta; } server {')).toThrow(RenderError);
  });
});

describe('assertSafeHostname', () => {
  it('lower-cases and keeps a normal FQDN', () => {
    expect(assertSafeHostname('A.Example.COM')).toBe('a.example.com');
  });

  it.each(['http://a.example.com', 'a.example.com:443', 'a_b.example.com', 'a.example.com.', '..', 'a..b'])(
    'refuses %j',
    (value) => {
      expect(() => assertSafeHostname(value)).toThrow(RenderError);
    }
  );
});

describe('certificateLineage', () => {
  it.each([
    ['a.example.com', 'example.com'],
    ['contest.example.co.th', 'co.th'],
    ['example.com', 'example.com'],
    ['localhost', 'localhost'],
  ])('maps %s to %s', (hostname, expected) => {
    expect(certificateLineage(hostname)).toBe(expected);
  });
});

describe('renderServeConfig', () => {
  const route = {
    contest_id: 1,
    hostname: 'a.example.com',
    path: '/',
    upstream: 'web-1:8888',
    tls: true,
    tailnet: 'cms-contest-1',
  };

  it('emits nothing when no name is exposed on the tailnet', () => {
    expect(renderServeConfig([{ ...route, tailnet: null }])).toBe('');
  });

  it('maps the path to its upstream under the substituted certificate domain', () => {
    const parsed = JSON.parse(renderServeConfig([route])) as {
      Web: Record<string, { Handlers: Record<string, { Proxy: string }> }>;
      AllowFunnel: Record<string, boolean>;
    };
    const key = '${TS_CERT_DOMAIN}:443';
    expect(parsed.Web[key].Handlers['/'].Proxy).toBe('http://web-1:8888');
    expect(parsed.AllowFunnel[key]).toBe(true);
  });
});

describe('parsePayload', () => {
  it('accepts the three arrays', () => {
    const payload = parsePayload('{"services":[],"wirings":[],"exposures":[]}');
    expect(payload).toEqual({ services: [], wirings: [], exposures: [] });
  });

  it.each([['[]'], ['null'], ['"x"']])('refuses a payload that is %s', (raw) => {
    expect(() => parsePayload(raw)).toThrow(WiringError);
  });

  it('refuses a payload missing a required array', () => {
    expect(() => parsePayload('{"services":[],"wirings":[]}')).toThrow(/exposures/);
  });
});

describe('renderFromPayload', () => {
  const web = service({ id: 1, name: 'web-1', host: 'web-1', contest_id: 1 });
  const payload: WiringPayload = {
    services: [web],
    wirings: [],
    exposures: [exposure({ contest_id: 1, hostname: 'a.example.com' })],
  };

  it('renders nginx blocks for the registry', () => {
    expect(renderFromPayload(payload, 'nginx')).toContain('server_name a.example.com;');
  });

  it('renders the tailnet serve config for the registry', () => {
    const withTailnet: WiringPayload = {
      ...payload,
      exposures: [exposure({ contest_id: 1, tailnet: 'cms-1' })],
    };
    expect(renderFromPayload(withTailnet, 'serve')).toContain('AllowFunnel');
  });

  it('refuses a registry with a wiring naming a service it lost', () => {
    const broken: WiringPayload = {
      ...payload,
      wirings: [{ from_service_id: 1, to_service_id: 99, relation: 'drains', enabled: true }],
    };
    expect(() => renderFromPayload(broken, 'nginx')).toThrow(WiringError);
  });

  it('refuses an exposure whose contest has nothing to answer on', () => {
    expect(() => renderFromPayload({ ...payload, services: [] }, 'nginx')).toThrow(WiringError);
  });
});

describe('the certificate a TLS block points at', () => {
  const route = { contest_id: 1, hostname: 'a.example.com', path: '/', upstream: 'w:8888', tls: true, tailnet: null };

  it('defaults to the contest proxy pair', () => {
    expect(renderNginxServers([route])).toContain(`ssl_certificate ${CONTEST_PROXY_CERTIFICATE.certificate};`);
  });

  it('renders a domain proxy lineage, key and shared ssl include when asked', () => {
    const out = renderNginxServers([route], {
      certificate: '/etc/letsencrypt/live/a.example.com/fullchain.pem',
      key: '/etc/letsencrypt/live/a.example.com/privkey.pem',
      sslInclude: '/etc/nginx/conf.d/nginx-ssl.conf',
    });
    expect(out).toContain('ssl_certificate /etc/letsencrypt/live/a.example.com/fullchain.pem;');
    expect(out).toContain('ssl_certificate_key /etc/letsencrypt/live/a.example.com/privkey.pem;');
    expect(out).toContain('include /etc/nginx/conf.d/nginx-ssl.conf;');
  });

  it('omits the ssl include when none is given', () => {
    expect(renderNginxServers([route], { certificate: '/x/c.pem', key: '/x/k.pem' })).not.toContain('include /etc/nginx');
  });

  it('refuses a certificate path that could inject a directive', () => {
    expect(() => assertSafeIncludePath('/x/c.pem; root /etc;')).toThrow(RenderError);
    expect(() => assertSafeIncludePath('relative/c.pem')).toThrow(RenderError);
  });
});

describe('parseCertificate', () => {
  it('reads the three flags and ignores the mode argument', () => {
    const spec = parseCertificate(['nginx', '--cert', '/a/c.pem', '--key', '/a/k.pem', '--ssl-include', '/a/s.conf']);
    expect(spec).toEqual({ certificate: '/a/c.pem', key: '/a/k.pem', sslInclude: '/a/s.conf' });
  });

  it('falls back to the contest proxy pair', () => {
    expect(parseCertificate(['nginx'])).toEqual(CONTEST_PROXY_CERTIFICATE);
  });
});


