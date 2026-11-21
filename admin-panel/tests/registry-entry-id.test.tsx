// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import en from '@/dictionaries/en.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { ServiceRegistryView } from '@/components/infrastructure/ServiceRegistryView';
import {
  draftOfExposure,
  draftOfService,
  draftOfWiring,
  requiredInt,
  resolveRole,
} from '@/components/infrastructure/registry-spec';
import type { ExposureRecord, ServiceRecord, WiringRecord } from '@/lib/service-wiring-contract';

const actions = vi.hoisted(() => ({
  saveServiceAction: vi.fn(),
  saveWiringAction: vi.fn(),
  saveExposureAction: vi.fn(),
  removeServiceAction: vi.fn(),
  removeWiringAction: vi.fn(),
  removeExposureAction: vi.fn(),
}));

const addToast = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/app/actions/serviceWiring', () => actions);
vi.mock('@/components/providers/ToastProvider', () => ({ useToast: () => ({ addToast }) }));
vi.mock('@/hooks/useConfirm', () => ({ useConfirm: () => () => Promise.resolve(true) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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

function renderView(services: ServiceRecord[] = [SERVICE]): void {
  render(
    <DictionaryProvider dict={en}>
      <ServiceRegistryView
        services={services}
        wirings={[]}
        exposures={[]}
        contests={[{ id: 1, name: 'Autumn' }]}
        title="Services"
        description="The service registry"
        permissionKeys={['container:control']}
      />
    </DictionaryProvider>,
  );
}

describe('registry-spec carries the row id and refuses a blank number', () => {
  it('reads a whole number only when one is present', () => {
    expect(requiredInt('7', 'a whole number is required')).toBe(7);
    expect(() => requiredInt('', 'a whole number is required')).toThrow('a whole number is required');
    expect(() => requiredInt(undefined, 'a whole number is required')).toThrow();
    expect(() => requiredInt('abc', 'a whole number is required')).toThrow();
  });

  it('names the role or throws rather than casting an unknown one', () => {
    expect(resolveRole('ContestWebServer', 'unknown role')).toBe('ContestWebServer');
    expect(() => resolveRole('NotARole', 'unknown role')).toThrow();
    expect(() => resolveRole(undefined, 'unknown role')).toThrow();
  });

  it('seeds every draft with the record id', () => {
    const service: ServiceRecord = SERVICE;
    const wiring: WiringRecord = { id: 2, from_service_id: 1, to_service_id: 3, relation: 'drains', enabled: true };
    const exposure: ExposureRecord = { id: 3, service_id: 1, hostname: 'a.example.com', path: '/', tls: true, tailnet: null };
    expect(draftOfService(service).id).toBe('1');
    expect(draftOfWiring(wiring).id).toBe('2');
    expect(draftOfExposure(exposure).id).toBe('3');
  });
});

describe('the registry dialog edits by id', () => {
  it('seeds the edit dialog from the row and saves it back under its id', async () => {
    actions.saveServiceAction.mockResolvedValue({ success: true });
    renderView();

    // Why the first of two: ResponsiveTable mounts the action cluster in both
    // the desktop row and the mobile card, so the same action appears twice.
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);

    expect(screen.getByDisplayValue('cms-contest-web-server-1')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(actions.saveServiceAction).toHaveBeenCalledTimes(1));
    expect(actions.saveServiceAction.mock.calls[0][0]).toMatchObject({
      id: 1,
      name: 'cms-contest-web-server-1',
      role: 'ContestWebServer',
    });
  });

  it('creates without an id when the dialog was opened for a new row', async () => {
    actions.saveServiceAction.mockResolvedValue({ success: true });
    renderView([]);

    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(actions.saveServiceAction).toHaveBeenCalledTimes(1));
    expect(actions.saveServiceAction.mock.calls[0][0].id).toBeUndefined();
  });

  it('refuses a blank required number instead of writing zero', async () => {
    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Wirings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add wiring' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    expect(actions.saveWiringAction).not.toHaveBeenCalled();
    expect(addToast.mock.calls[0][0]).toMatchObject({ type: 'error', title: 'Not saved' });
  });
});
