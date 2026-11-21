// @vitest-environment happy-dom
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import en from '@/dictionaries/en.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { ServiceRegistryView } from '@/components/infrastructure/ServiceRegistryView';
import type { ServiceRecord } from '@/lib/service-wiring-contract';

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
  name: 'cms-contest-web-server-1',
  role: 'ContestWebServer',
  shard: 0,
  host: 'web-1',
  http_port: 8888,
  rpc_port: 21000,
  db_profile: 'default',
  contest_id: 1,
  enabled: true,
  image: '',
  pull_policy: 'missing',
};

function renderView(services: ServiceRecord[] = [SERVICE], permissionKeys: readonly string[] = ['container:control']): HTMLElement {
  const { container } = render(
    <DictionaryProvider dict={en}>
      <ServiceRegistryView
        services={services}
        wirings={[]}
        exposures={[]}
        contests={[]}
        title="Services"
        description="The service registry"
        permissionKeys={permissionKeys}
      />
    </DictionaryProvider>,
  );
  return container;
}

describe('the registry screen renders through the templated primitives', () => {
  it('keys rows by record id and carries the shared action cluster', () => {
    const container = renderView();
    // The row id, not a render index, is the key the table hands to the DOM.
    expect(container.querySelector('[data-row-id="1"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: `${copy.kinds.service} (1)` })).not.toBeNull();
    expect(screen.getAllByRole('group', { name: copy.actions.rowGroup }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: copy.actions.edit }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: copy.actions.remove }).length).toBeGreaterThan(0);
  });

  it('shows the per-tab empty copy through EmptyState', () => {
    renderView([]);
    expect(screen.getByText(copy.empty.service)).not.toBeNull();
  });

  it('switches sections through the tab strip and keeps its own empty copy', () => {
    renderView([SERVICE]);

    fireEvent.click(screen.getByRole('button', { name: copy.tabs.wirings }));
    expect(screen.getByText(copy.empty.wiring)).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: copy.tabs.exposures }));
    expect(screen.getByText(copy.empty.exposure)).not.toBeNull();
  });
});

describe('the registry screen leaves no hand-rolled table behind', () => {
  const dir = path.resolve(__dirname, '..', 'src/components/infrastructure');

  it('deletes the bespoke RegistryTable module', () => {
    expect(fs.existsSync(path.join(dir, 'RegistryTable.tsx'))).toBe(false);
  });

  it('renders no raw <table> element in any infrastructure source', () => {
    const offenders = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.tsx') || name.endsWith('.ts'))
      .filter((name) => fs.readFileSync(path.join(dir, name), 'utf8').includes('<table'));
    expect(offenders).toEqual([]);
  });
});

describe('the registry screen gates every control on container:control', () => {
  it('offers the add button and row actions only while the key is held', () => {
    renderView();
    expect(screen.getByRole('button', { name: copy.actions.addService })).not.toBeNull();
    expect(screen.getAllByRole('button', { name: copy.actions.edit }).length).toBeGreaterThan(0);
    cleanup();

    renderView([SERVICE], []);
    expect(screen.queryByRole('button', { name: copy.actions.addService })).toBeNull();
    expect(screen.queryByRole('button', { name: copy.actions.edit })).toBeNull();
    expect(screen.queryByRole('group', { name: copy.actions.rowGroup })).toBeNull();
  });

  it('keeps the rows readable without the control key', () => {
    renderView([SERVICE], []);
    expect(screen.getAllByText('cms-contest-web-server-1').length).toBeGreaterThan(0);
  });
});
