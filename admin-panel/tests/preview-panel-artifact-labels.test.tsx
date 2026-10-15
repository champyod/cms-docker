// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { PreviewPanel } from '@/components/infrastructure/PreviewPanel';
import type { Dictionary } from '@/lib/dictionary';
import type { RegistryArtifact } from '@/lib/service-wiring-cli';

const mocks = vi.hoisted(() => ({ previewRegistryAction: vi.fn() }));

vi.mock('@/app/actions/serviceWiring', () => ({ previewRegistryAction: mocks.previewRegistryAction }));

const copy = en.infrastructure.services.preview;
const thaiCopy = th.infrastructure.services.preview;

const NGINX_BLOCK: RegistryArtifact = {
  mode: 'nginx',
  node: null,
  content: 'server {\n  server_name a.example.com;\n}\n',
};

const LOCATION_FRAGMENT: RegistryArtifact = {
  mode: 'location',
  node: 'primary',
  content: 'location ^~ /beta/ {\n}\n',
};

const SERVE_CONFIG: RegistryArtifact = {
  mode: 'serve',
  node: 'cms-1',
  content: 'AllowFunnel: true\n',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPanel(dict: Dictionary, artifacts: readonly RegistryArtifact[]): void {
  mocks.previewRegistryAction.mockResolvedValue({ success: true, artifacts });
  render(
    <DictionaryProvider dict={dict}>
      <PreviewPanel />
    </DictionaryProvider>,
  );
}

describe('PreviewPanel artifact labels', () => {
  it('labels the nginx server blocks as nginx config with the front-reload instruction', async () => {
    renderPanel(en, [NGINX_BLOCK]);
    expect(await screen.findByRole('heading', { name: copy.nginxTitle })).toBeTruthy();
    expect(screen.getByText(copy.nginxHotApply)).toBeTruthy();
  });

  it('labels a location fragment as nginx config for its front vhost, never as a tailnet serve config', async () => {
    renderPanel(en, [LOCATION_FRAGMENT]);

    const heading = await screen.findByRole('heading', { name: copy.locationTitle.replace('{node}', 'primary') });
    expect(heading.textContent).toContain('primary');
    expect(screen.getByText(copy.locationHotApply)).toBeTruthy();
    expect(screen.queryByText(copy.serveHotApply)).toBeNull();
    expect(screen.queryByRole('heading', { name: copy.serveTitle.replace('{node}', 'primary') })).toBeNull();
  });

  it('keeps the tailnet serve config on its node title and node instruction', async () => {
    renderPanel(en, [SERVE_CONFIG]);
    expect(await screen.findByRole('heading', { name: copy.serveTitle.replace('{node}', 'cms-1') })).toBeTruthy();
    expect(screen.getByText(copy.serveHotApply)).toBeTruthy();
  });

  it('carries the location label in Thai with the vhost name', async () => {
    renderPanel(th, [LOCATION_FRAGMENT]);
    expect(
      await screen.findByRole('heading', { name: thaiCopy.locationTitle.replace('{node}', 'primary') }),
    ).toBeTruthy();
    expect(screen.getByText(thaiCopy.locationHotApply)).toBeTruthy();
  });
});
