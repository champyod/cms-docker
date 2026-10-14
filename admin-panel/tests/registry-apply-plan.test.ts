import { describe, expect, it } from 'vitest';

import { registryApplyPlan } from '@/lib/restart-service-scope';

describe('registryApplyPlan', () => {
  it('reloads the front with no restart for an exposure change', () => {
    expect(registryApplyPlan('front-reload', ['contest-web-server'])).toEqual({ kind: 'front-reload' });
  });

  it('scopes a service change to that service on the main stack', () => {
    expect(registryApplyPlan('service-recreate', ['contest-web-server'])).toEqual({
      kind: 'recreate',
      compose: 'stack',
      services: ['contest-web-server'],
    });
  });

  it('scopes a tailnet change to the generated project', () => {
    expect(registryApplyPlan('tailnet-node', ['cms-tailscale-cms-7'])).toEqual({
      kind: 'recreate',
      compose: 'tailscale',
      services: ['cms-tailscale-cms-7'],
    });
  });

  it('drops a name that could not be a compose service before it reaches a shell', () => {
    const plan = registryApplyPlan('service-recreate', ['good-1', 'bad; rm -rf /', '$(whoami)']);
    expect(plan).toEqual({ kind: 'recreate', compose: 'stack', services: ['good-1'] });
  });

  it('drops a protected service from the scope', () => {
    expect(registryApplyPlan('service-recreate', ['redis-rate-limit'])).toEqual({
      kind: 'recreate',
      compose: 'stack',
      services: [],
    });
  });
});
