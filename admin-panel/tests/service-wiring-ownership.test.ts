import { describe, expect, it } from 'vitest';

import { exposureOwnerships } from '@/lib/service-wiring-ownership';
import type { ExposureRow, ServiceRow } from '@/lib/service-wiring';

const SERVICE: ServiceRow = {
  id: 1,
  name: 'web-1',
  role: 'ContestWebServer',
  shard: 0,
  host: 'web-1',
  http_port: 8888,
  rpc_port: 21000,
  db_profile: 'default',
  contest_id: 7,
  enabled: true,
};

/** A front vhost map line as the sync publishes it: paths, then the key each path came from. */
const FRONT = ['primary|front.example.com|/ /admin /ranking /login /ws|/=CONTEST_ROUTE_PATH /admin=ADMIN_ROUTE_PATH /ranking=RANKING_ROUTE_PATH /login=- /ws=-'];

function exposure(overrides: Partial<ExposureRow> = {}): ExposureRow {
  return { service_id: 1, hostname: 'front.example.com', path: '/', tls: true, tailnet: null, ...overrides };
}

describe('exposureOwnerships', () => {
  it('names config.toml and the operator key of a path the front vhost already serves', () => {
    expect(exposureOwnerships([exposure({ path: '/admin' })], [SERVICE], FRONT)).toEqual([
      {
        kind: 'curated',
        file: 'config.toml',
        key: 'ADMIN_ROUTE_PATH',
        reason: '/admin on front.example.com is a location the front\'s own vhost already serves',
      },
    ]);
  });

  it('leaves a path the vhost does not serve to the database', () => {
    expect(exposureOwnerships([exposure({ path: '/beta' })], [SERVICE], FRONT)).toEqual([{ kind: 'database' }]);
  });

  it('names the front template for a fixed location no operator key owns', () => {
    expect(exposureOwnerships([exposure({ path: '/login' })], [SERVICE], FRONT)).toEqual([
      expect.objectContaining({ kind: 'curated', file: 'config/grader.nginx.conf.template', key: null }),
    ]);
  });

  it('names the rendered front config for a hostname no route row owns', () => {
    const bare = ['front.example.com'];
    expect(exposureOwnerships([exposure()], [SERVICE], bare)).toEqual([
      expect.objectContaining({ kind: 'curated', file: 'config/grader.nginx.conf', key: null }),
    ]);
  });

  it('resolves a path-only exposure through the vhost its contest claims', () => {
    const rows = [exposure({ path: '/' }), exposure({ hostname: '', path: '/ranking' })];
    expect(exposureOwnerships(rows, [SERVICE], FRONT)[1]).toEqual(
      expect.objectContaining({ kind: 'curated', key: 'RANKING_ROUTE_PATH' }),
    );
  });

  it('reports nothing for an exposure the registry cannot resolve', () => {
    expect(exposureOwnerships([exposure({ service_id: 99 })], [SERVICE], FRONT)).toEqual([null]);
  });

  it('keeps the database and curated owners side by side in row order', () => {
    const rows = [exposure({ path: '/beta' }), exposure({ path: '/admin' })];
    expect(exposureOwnerships(rows, [SERVICE], FRONT).map((owner) => owner?.kind)).toEqual(['database', 'curated']);
  });
});
