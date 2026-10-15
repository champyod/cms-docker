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
import { parseFrontVhostList } from '@/lib/service-wiring-front-vhosts';
import { collectWiringProblems } from '@/lib/service-wiring-problems';
import {
  parseCertificate,
  parsePayload,
  renderFromPayload,
  renderRegistryArtifacts,
  type WiringPayload,
} from '@/lib/service-wiring-cli';
import {
  assertSafeIncludePath,
  assertSafeHostname,
  assertSafePath,
  certificateLineage,
  assertSafeTailnetNode,
  CONTEST_PROXY_CERTIFICATE,
  renderLocationFragments,
  renderNginxServers,
  renderServeConfig,
  renderServeConfigs,
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

function exposure(overrides: Partial<ExposureRow> & Pick<ExposureRow, 'service_id'>): ExposureRow {
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
  const web3 = service({ id: 1, name: 'web-3', host: 'web-3', contest_id: 3, http_port: 8888 });

  it('routes to the service the exposure names, whatever role it carries', () => {
    const ranking = service({ id: 2, name: 'cms-ranking-board', role: 'RankingWebServer', host: 'rank', contest_id: null, http_port: 8890 });
    const routes = exposureRoutes(
      [exposure({ service_id: 2, hostname: 'rank.example.com' }), exposure({ service_id: 1 })],
      [web3, ranking],
    );
    expect(routes.map((route) => route.upstream)).toEqual(['rank:8890', 'web-3:8888']);
  });

  it('fails when the exposure names a service the registry lost', () => {
    expect(() => exposureRoutes([exposure({ service_id: 9 })], [web3])).toThrow(/unknown service id 9/);
  });

  it('refuses to proxy to a service that is not enabled', () => {
    const off = service({ id: 4, name: 'web-off', enabled: false });
    expect(() => exposureRoutes([exposure({ service_id: 4 })], [off])).toThrow(/not enabled/);
  });

  it('refuses to proxy to a service with no http port', () => {
    const noHttp = service({ id: 5, name: 'web-x', host: 'web-x', http_port: null });
    expect(() => exposureRoutes([exposure({ service_id: 5 })], [noHttp])).toThrow(/http_port/);
  });

  it('normalises the path it carries through', () => {
    expect(exposureRoutes([exposure({ service_id: 1, path: 'beta/' })], [web3])[0].path).toBe('/beta');
  });

  it("answers a path-only exposure under the vhost its service's contest claims", () => {
    const routes = exposureRoutes(
      [
        exposure({ service_id: 1, hostname: 'cms3.example.com', path: '/' }),
        exposure({ service_id: 1, hostname: null, path: '/beta' }),
      ],
      [web3],
    );
    expect(routes.map((route) => route.hostname)).toEqual(['cms3.example.com', 'cms3.example.com']);
    expect(routes[1].path).toBe('/beta');
  });

  it("answers a path-only exposure of a service no contest owns on the deployment's own host", () => {
    const ranking = service({ id: 2, name: 'cms-ranking-board', role: 'RankingWebServer', host: 'rank', contest_id: null, http_port: 8890 });
    const routes = exposureRoutes(
      [
        exposure({ service_id: 1, hostname: 'cms.example.com', path: '/' }),
        exposure({ service_id: 2, hostname: null, path: '/rank' }),
      ],
      [web3, ranking],
    );
    expect(routes[1].hostname).toBe('cms.example.com');
  });

  it('renders a server block for an exposure whose hostname the front does not declare', () => {
    expect(
      exposureRoutes([exposure({ service_id: 1, hostname: 'cms.example.com' })], [web3], ['primary|front.example.com'])
    ).toEqual([
      {
        hostname: 'cms.example.com',
        path: '/',
        upstream: 'web-3:8888',
        tls: true,
        tailnet: null,
        fragmentLabel: null,
      },
    ]);
  });

  it("renders an exposure under the front's own vhost as that vhost's fragment", () => {
    const routes = exposureRoutes(
      [exposure({ service_id: 1, hostname: 'front.example.com', path: '/beta' })],
      [web3],
      ['primary|front.example.com']
    );
    expect(routes).toHaveLength(1);
    expect(routes[0].fragmentLabel).toBe('primary');
    expect(routes[0].hostname).toBe('front.example.com');
  });

  it('keeps the label when the same hostname also arrives without one', () => {
    const routes = exposureRoutes(
      [exposure({ service_id: 1, hostname: 'front.example.com', path: '/beta' })],
      [web3],
      ['front.example.com', 'primary|front.example.com']
    );
    expect(routes[0].fragmentLabel).toBe('primary');
  });

  it('refuses a fragment whose path the front vhost already serves', () => {
    expect(() =>
      exposureRoutes(
        [exposure({ service_id: 1, hostname: 'front.example.com', path: '/admin' })],
        [web3],
        ['primary|front.example.com']
      )
    ).toThrow(/already serves/);
  });

  it('refuses an exposure on a hostname the front declares and no route row owns', () => {
    expect(() =>
      exposureRoutes([exposure({ service_id: 1, hostname: 'acme.example.com' })], [web3], ['acme.example.com'])
    ).toThrow(/already declares/);
  });

  it('refuses a path-only exposure whose service\'s contest owns no vhost', () => {
    expect(() => exposureRoutes([exposure({ service_id: 1, hostname: null })], [web3])).toThrow(/no vhost/);
  });
});

describe('parseFrontVhostList', () => {
  it('reads the label and the hostname of each entry', () => {
    expect(parseFrontVhostList(['primary|Front.Example.com'])).toEqual([
      { hostname: 'front.example.com', label: 'primary' },
    ]);
  });

  it('keeps a bare hostname without a label', () => {
    expect(parseFrontVhostList(['acme.example.com'])).toEqual([
      { hostname: 'acme.example.com', label: null },
    ]);
  });

  it('lets the label win over a bare duplicate, whatever the order', () => {
    expect(parseFrontVhostList(['front.example.com', 'primary|front.example.com'])).toEqual([
      { hostname: 'front.example.com', label: 'primary' },
    ]);
  });

  it('drops an entry that names no hostname', () => {
    expect(parseFrontVhostList(['', '   ', 'primary|'])).toEqual([]);
  });
});

describe('renderNginxServers', () => {
  const route = {
    hostname: 'a.example.com',
    path: '/',
    upstream: 'web-1:8888',
    tls: true,
    tailnet: null,
    fragmentLabel: null,
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

  it('groups a root and a path exposure of one hostname into one block, owner first', () => {
    const out = renderNginxServers([route, { ...route, path: '/beta', upstream: 'web-2:8888' }]);
    expect(out.match(/server \{/g)).toHaveLength(1);
    expect(out.indexOf('location / {')).toBeLessThan(out.indexOf('location ^~ /beta/ {'));
    expect(out).toContain('proxy_pass http://web-2:8888/;');
  });

  it('renders a contest root and its path-only exposure into one block', () => {
    const own = service({ id: 1, name: 'web-3', host: 'web-3', contest_id: 3 });
    const out = renderNginxServers(
      exposureRoutes(
        [
          exposure({ service_id: 1, hostname: 'cms3.example.com', path: '/' }),
          exposure({ service_id: 1, hostname: null, path: '/beta' }),
        ],
        [own],
      ),
    );
    expect(out.match(/server \{/g)).toHaveLength(1);
    expect(out).toContain('location ^~ /beta/ {');
    expect(out).toContain('proxy_pass http://web-3:8888/;');
  });

  it('keeps one block per hostname', () => {
    const out = renderNginxServers([route, { ...route, hostname: 'b.example.com' }]);
    expect(out.match(/server \{/g)).toHaveLength(2);
  });

  it("carries the front's proxy headers and location security headers", () => {
    const out = renderNginxServers([route]);
    expect(out).toContain('proxy_set_header Host $host;');
    expect(out).toContain('proxy_set_header X-Real-IP $remote_addr;');
    expect(out).toContain('proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
    expect(out).toContain('proxy_set_header X-Forwarded-Proto $scheme;');
    expect(out).toContain('add_header Strict-Transport-Security "max-age=300; includeSubDomains" always;');
  });

  it('refuses a hostname that could inject a directive', () => {
    const hostile = { ...route, hostname: 'a.example.com; root /etc;' };
    expect(() => renderNginxServers([hostile])).toThrow(RenderError);
  });

  it('refuses a path that could inject a location', () => {
    expect(() => assertSafePath('/beta; } server {')).toThrow(RenderError);
  });
});

describe('renderLocationFragments', () => {
  const own = service({ id: 1, name: 'web-3', host: 'web-3', contest_id: 3 });
  const exposureOnFront = [exposure({ service_id: 1, hostname: 'front.example.com', path: '/beta' })];

  it('emits the locations of one front vhost and nothing else', () => {
    const routes = exposureRoutes(exposureOnFront, [own], ['primary|front.example.com']);
    const out = renderLocationFragments(routes, 'primary');
    expect(out).toContain('location ^~ /beta/ {');
    expect(out).toContain('proxy_pass http://web-3:8888/;');
    expect(out).toContain('add_header Strict-Transport-Security "max-age=300; includeSubDomains" always;');
    expect(out).not.toContain('server {');
    expect(out).not.toContain('listen ');
    expect(out).not.toContain('server_name');
    expect(out).not.toContain('ssl_certificate');
  });

  it('leaves a fragment route out of the server blocks it would silently lose', () => {
    const routes = exposureRoutes(exposureOnFront, [own], ['primary|front.example.com']);
    expect(renderNginxServers(routes)).toBe('');
  });

  it('emits nothing for a label no exposure renders into', () => {
    const routes = exposureRoutes(exposureOnFront, [own], ['primary|front.example.com']);
    expect(renderLocationFragments(routes, 'admin')).toBe('');
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
    hostname: 'a.example.com',
    path: '/',
    upstream: 'web-1:8888',
    tls: true,
    tailnet: 'cms-contest-1',
    fragmentLabel: null,
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
    exposures: [exposure({ service_id: 1, hostname: 'a.example.com' })],
  };

  it('renders nginx blocks for the registry', () => {
    expect(renderFromPayload(payload, 'nginx')).toContain('server_name a.example.com;');
  });

  it('renders the tailnet serve config for the registry', () => {
    const withTailnet: WiringPayload = {
      ...payload,
      exposures: [exposure({ service_id: 1, tailnet: 'cms-1' })],
    };
    expect(renderFromPayload(withTailnet, 'serve', CONTEST_PROXY_CERTIFICATE, 'cms-1')).toContain('AllowFunnel');
  });

  it('refuses a registry with a wiring naming a service it lost', () => {
    const broken: WiringPayload = {
      ...payload,
      wirings: [{ from_service_id: 1, to_service_id: 99, relation: 'drains', enabled: true }],
    };
    expect(() => renderFromPayload(broken, 'nginx')).toThrow(WiringError);
  });

  it('refuses an exposure naming a service the registry lost', () => {
    expect(() => renderFromPayload({ ...payload, services: [] }, 'nginx')).toThrow(WiringError);
  });
});

describe('the certificate a TLS block points at', () => {
  const route = { hostname: 'a.example.com', path: '/', upstream: 'w:8888', tls: true, tailnet: null, fragmentLabel: null };

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


describe('per-node tailnet configs', () => {
  const web = service({ id: 1, name: 'web-1', host: 'web-1', contest_id: 1 });

  it('gives each node only its own exposures', () => {
    const routes = exposureRoutes(
      [
        exposure({ service_id: 1, hostname: 'a.example.com', tailnet: 'cms-1' }),
        exposure({ service_id: 1, hostname: 'b.example.com', path: '/b', tailnet: 'cms-2' }),
      ],
      [web]
    );
    const configs = renderServeConfigs(routes);
    expect([...configs.keys()]).toEqual(['cms-1', 'cms-2']);
    expect(configs.get('cms-1')).not.toContain('/b');
  });

  it('skips an exposure with no tailnet name', () => {
    const routes = exposureRoutes([exposure({ service_id: 1, tailnet: null })], [web]);
    expect(renderServeConfigs(routes).size).toBe(0);
  });

  it('refuses two exposures claiming the same path on one node', () => {
    const routes = exposureRoutes(
      [
        exposure({ service_id: 1, hostname: 'a.example.com', tailnet: 'cms-1' }),
        exposure({ service_id: 1, hostname: 'b.example.com', tailnet: 'cms-1' }),
      ],
      [web]
    );
    expect(() => renderServeConfigs(routes)).toThrow(RenderError);
  });

  it.each(['../escape', 'a/b', 'UPPER', '-leading', ''])('refuses the node name %j', (node) => {
    expect(() => assertSafeTailnetNode(node)).toThrow(RenderError);
  });

  it('refuses a traversal node before it can name a file', () => {
    const routes = exposureRoutes([exposure({ service_id: 1, tailnet: '../../etc/nginx' })], [web]);
    expect(() => renderServeConfigs(routes)).toThrow(RenderError);
  });

  it('needs a node to render serve mode', () => {
    const payload: WiringPayload = {
      services: [web],
      wirings: [],
      exposures: [exposure({ service_id: 1, tailnet: 'cms-1' })],
    };
    expect(() => renderFromPayload(payload, 'serve')).toThrow(WiringError);
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

describe('collectWiringProblems', () => {
  const shared = service({ id: 1, name: 'cms-contest-web-server' });

  it('reports nothing for a clean registry', () => {
    expect(collectWiringProblems([shared], [], [exposure({ service_id: 1 })])).toEqual([]);
  });

  it('names a wiring whose endpoint does not exist', () => {
    const wirings: WiringRow[] = [{ from_service_id: 1, to_service_id: 9, relation: 'drains', enabled: true }];
    const problems = collectWiringProblems([shared], wirings, []);
    expect(problems).toHaveLength(1);
    expect(problems[0].area).toBe('wiring');
    expect(problems[0].message).toContain('9');
  });

  it('reports an exposure on a hostname the front declares and no route row owns', () => {
    const problems = collectWiringProblems([shared], [], [exposure({ service_id: 1, hostname: 'cms.example.com' })], ['cms.example.com']);
    expect(problems).toHaveLength(1);
    expect(problems[0].area).toBe('exposure');
    expect(problems[0].message).toContain('already declares');
  });

  it("reports nothing for an exposure that renders into a front vhost's fragment", () => {
    const problems = collectWiringProblems(
      [shared],
      [],
      [exposure({ service_id: 1, hostname: 'front.example.com', path: '/beta' })],
      ['primary|front.example.com']
    );
    expect(problems).toEqual([]);
  });

  it('reports a fragment path the front vhost already serves', () => {
    const problems = collectWiringProblems(
      [shared],
      [],
      [exposure({ service_id: 1, hostname: 'front.example.com', path: '/classic/' })],
      ['primary|front.example.com']
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].area).toBe('exposure');
    expect(problems[0].message).toContain('already serves');
  });

  it('reports a ProxyService row that names no contest', () => {
    const proxy = service({ id: 7, name: 'cms-proxy-service', role: 'ProxyService', contest_id: null });
    const problems = collectWiringProblems([shared, proxy], [], []);
    expect(problems).toHaveLength(1);
    expect(problems[0].area).toBe('service');
    expect(problems[0].message).toContain('names no contest');
  });

  it('reports an exposure naming a service the registry lost', () => {
    const problems = collectWiringProblems([shared], [], [exposure({ service_id: 5 })]);
    expect(problems).toHaveLength(1);
    expect(problems[0].area).toBe('exposure');
    expect(problems[0].message).toContain('service 5');
  });

  it('reports an exposed service that is not enabled', () => {
    const off = service({ id: 2, name: 'web-off', enabled: false });
    const problems = collectWiringProblems([shared, off], [], [exposure({ service_id: 2 })]);
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('not enabled');
  });

  it('reports an exposed service with no http_port to dial', () => {
    const noHttp = service({ id: 3, name: 'rank', role: 'RankingWebServer', http_port: null });
    const problems = collectWiringProblems([shared, noHttp], [], [exposure({ service_id: 3 })]);
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('no http_port');
  });

  it('reports a path-only exposure whose contest owns no vhost', () => {
    const own = service({ id: 4, name: 'web-4', contest_id: 4 });
    const problems = collectWiringProblems([shared, own], [], [exposure({ service_id: 4, hostname: null })]);
    expect(problems).toHaveLength(1);
    expect(problems[0].area).toBe('exposure');
    expect(problems[0].message).toContain('no vhost of its own');
  });

  it('reports two exposures that normalise onto one location', () => {
    const other = service({ id: 6, name: 'web-6', contest_id: 6 });
    const exposures = [
      exposure({ service_id: 1, hostname: 'a.example.com', path: '/' }),
      exposure({ service_id: 6, hostname: 'A.EXAMPLE.COM', path: '' }),
    ];
    const problems = collectWiringProblems([shared, other], [], exposures);
    expect(problems).toHaveLength(1);
    expect(problems[0].area).toBe('exposure');
    expect(problems[0].message).toContain('a.example.com/');
  });
});

describe('renderRegistryArtifacts', () => {
  const web = service({ id: 1, name: 'web-1', host: 'web-1', contest_id: 1 });
  const payload: WiringPayload = {
    services: [web],
    wirings: [],
    exposures: [exposure({ service_id: 1, hostname: 'a.example.com', tailnet: 'cms-1' })],
  };

  it('renders the nginx blocks through the same renderer the sync uses', () => {
    const [nginx] = renderRegistryArtifacts(payload);
    expect(nginx.mode).toBe('nginx');
    expect(nginx.node).toBeNull();
    expect(nginx.content).toBe(renderFromPayload(payload, 'nginx'));
    expect(nginx.content).toContain('server_name a.example.com;');
  });

  it('renders one location fragment per front vhost the registry exposes under', () => {
    const onFront: WiringPayload = {
      ...payload,
      exposures: [exposure({ service_id: 1, hostname: 'front.example.com', path: '/beta' })],
    };
    const fragments = renderRegistryArtifacts(onFront, ['primary|front.example.com', 'admin|admin.example.com'])
      .filter((artifact) => artifact.mode === 'location');
    expect(fragments.map((artifact) => artifact.node)).toEqual(['primary', 'admin']);
    expect(fragments[0].content).toContain('location ^~ /beta/ {');
    expect(fragments[1].content).toBe('');
  });

  it('renders one serve config per tailnet node an exposure claims', () => {
    const serve = renderRegistryArtifacts(payload).filter((artifact) => artifact.mode === 'serve');
    expect(serve.map((artifact) => artifact.node)).toEqual(['cms-1']);
    expect(serve[0].content).toBe(renderFromPayload(payload, 'serve', CONTEST_PROXY_CERTIFICATE, 'cms-1'));
    expect(serve[0].content).toContain('AllowFunnel');
  });

  it('renders a node claimed by more than one exposure once', () => {
    const twoNodes: WiringPayload = {
      ...payload,
      exposures: [
        exposure({ service_id: 1, hostname: 'a.example.com', tailnet: 'cms-1' }),
        exposure({ service_id: 1, hostname: 'b.example.com', path: '/b', tailnet: 'cms-1' }),
      ],
    };
    expect(renderRegistryArtifacts(twoNodes).filter((artifact) => artifact.mode === 'serve')).toHaveLength(1);
  });

  it('refuses a registry the sync would refuse', () => {
    const broken: WiringPayload = {
      ...payload,
      wirings: [{ from_service_id: 1, to_service_id: 99, relation: 'drains', enabled: true }],
    };
    expect(() => renderRegistryArtifacts(broken)).toThrow(WiringError);
  });
});


