import { describe, expect, it } from 'vitest';

import { parseFrontVhosts } from '@/lib/front-vhosts';

describe('parseFrontVhosts', () => {
  it('reads every name from every server_name line, lower-cased and deduplicated', () => {
    const config = [
      'server {',
      '    server_name cms.mwit.ac.th;',
      '}',
      'server {',
      '    server_name Admin.Cms.Mwit.ac.th admin.example.com;',
      '}',
    ].join('\n');
    expect(parseFrontVhosts(config)).toEqual([
      'cms.mwit.ac.th',
      'admin.cms.mwit.ac.th',
      'admin.example.com',
    ]);
  });

  it('ignores a name-like line outside a server block', () => {
    expect(parseFrontVhosts('# server_name not.real.example;')).toEqual([]);
  });

  it('reads nothing when no block declares a name', () => {
    expect(parseFrontVhosts('server {\n    listen 443 ssl;\n}')).toEqual([]);
  });
});
