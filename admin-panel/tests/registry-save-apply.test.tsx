// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import en from '@/dictionaries/en.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { ExposureApplyNotice } from '@/components/infrastructure/ExposureApplyNotice';
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

vi.mock('@/app/actions/exposureApply', () => ({ saveExposureApplyAction: vi.fn() }));
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

function renderView(): void {
  render(
    <DictionaryProvider dict={en}>
      <ServiceRegistryView
        services={[SERVICE]}
        wirings={[]}
        exposures={[]}
        contests={[]}
        title="Services"
        description="The service registry"
        permissionKeys={['container:control']}
        frontVhosts={[]}
      />
    </DictionaryProvider>,
  );
}

describe('the exposure control promises the whole job', () => {
  it('reads Save & apply on the exposure editor and keeps a plain Save elsewhere', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: copy.tabs.exposures }));
    fireEvent.click(screen.getByRole('button', { name: copy.actions.addExposure }));
    expect(screen.queryByRole('button', { name: copy.actions.saveApply })).not.toBeNull();

    cleanup();
    renderView();
    fireEvent.click(screen.getByRole('button', { name: copy.actions.addService }));
    expect(screen.queryByRole('button', { name: copy.actions.saveApply })).toBeNull();
    expect(screen.queryByRole('button', { name: copy.actions.save })).not.toBeNull();
  });
});

describe('the front\'s three answers', () => {
  const cases = [
    { outcome: 'applied' as const, title: copy.apply.applied, message: 'routes.example.com/1 is live' },
    { outcome: 'refused-validation' as const, title: copy.apply.refusedValidation, message: 'unsafe hostname' },
    { outcome: 'refused-nginx' as const, title: copy.apply.refusedNginx, message: 'nginx: [emerg] bad directive' },
  ];

  for (const item of cases) {
    it(`shows "${item.title}" for ${item.outcome}, naming the row it was about`, () => {
      render(
        <DictionaryProvider dict={en}>
          <ExposureApplyNotice report={{ label: 'routes.example.com/1', outcome: item.outcome, error: item.message }} />
        </DictionaryProvider>,
      );
      expect(screen.getByText(item.title)).not.toBeNull();
      expect(screen.getByText(/routes\.example\.com\/1/)).not.toBeNull();
      if (item.outcome !== 'applied') expect(screen.getByText(new RegExp(item.message.replace(/[[\]]/g, '\\$&')))).not.toBeNull();
    });
  }

  it('renders nothing before a save has answered', () => {
    render(
      <DictionaryProvider dict={en}>
        <ExposureApplyNotice report={null} />
      </DictionaryProvider>,
    );
    expect(screen.queryByText(copy.apply.applied)).toBeNull();
  });
});
