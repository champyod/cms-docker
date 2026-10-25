// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import en from '@/dictionaries/en.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { ServiceRegistryView } from '@/components/infrastructure/ServiceRegistryView';
import type { ExposureRecord, ServiceRecord } from '@/lib/service-wiring-contract';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/app/actions/serviceWiring', () => ({
  saveServiceAction: vi.fn(),
  saveWiringAction: vi.fn(),
  saveExposureAction: vi.fn(),
  removeServiceAction: vi.fn(),
  removeWiringAction: vi.fn(),
  removeExposureAction: vi.fn(),
}));

vi.mock('@/components/providers/ToastProvider', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('@/hooks/useConfirm', () => ({ useConfirm: () => () => Promise.resolve(true) }));

afterEach(() => cleanup());

const copy = en.infrastructure.services;

const SERVICE: ServiceRecord = {
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
  image: '',
  pull_policy: 'missing',
};

/** A front vhost the route table owns: `/admin` is the operator's ADMIN_ROUTE_PATH. */
const FRONT_VHOSTS = ['primary|front.example.com|/ /admin|/=CONTEST_ROUTE_PATH /admin=ADMIN_ROUTE_PATH'];

const CURATED: ExposureRecord = { id: 11, service_id: 1, hostname: 'front.example.com', path: '/admin', tls: true, tailnet: null };
const OWNED: ExposureRecord = { id: 12, service_id: 1, hostname: 'front.example.com', path: '/beta', tls: true, tailnet: null };

function renderExposures(exposures: ExposureRecord[]): HTMLElement {
  const { container } = render(
    <DictionaryProvider dict={en}>
      <ServiceRegistryView
        services={[SERVICE]}
        wirings={[]}
        exposures={exposures}
        contests={[]}
        title="Services"
        description="The service registry"
        permissionKeys={['container:control']}
        frontVhosts={FRONT_VHOSTS}
      />
    </DictionaryProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: copy.tabs.exposures }));
  return container;
}

function row(container: HTMLElement, id: number): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[data-row-id="${id}"]`);
  if (found === null) throw new Error(`row ${id} is not rendered`);
  return found;
}

describe('an exposure the deployment\'s own config owns', () => {
  it('names config.toml and the exact key that owns its path', () => {
    const container = renderExposures([CURATED]);
    expect(row(container, 11).textContent).toContain(`config.toml · ADMIN_ROUTE_PATH`);
  });

  it('offers no edit control, because the panel cannot move a curated route', () => {
    const container = renderExposures([CURATED]);
    expect(within(row(container, 11)).queryByRole('button', { name: copy.actions.edit })).toBeNull();
    // The row is still removable: a refusal left in the registry has to be deletable.
    expect(within(row(container, 11)).getByRole('button', { name: copy.actions.remove })).not.toBeNull();
  });

  it('leaves an exposure the database owns its edit control and its own source', () => {
    const container = renderExposures([OWNED]);
    expect(within(row(container, 12)).getByRole('button', { name: copy.actions.edit })).not.toBeNull();
    expect(row(container, 12).textContent).toContain(copy.values.database);
    expect(row(container, 12).textContent).not.toContain('config.toml');
  });

  it('shows both owners side by side in one table', () => {
    const container = renderExposures([CURATED, OWNED]);
    expect(within(row(container, 11)).queryByRole('button', { name: copy.actions.edit })).toBeNull();
    expect(within(row(container, 12)).getByRole('button', { name: copy.actions.edit })).not.toBeNull();
  });
});
