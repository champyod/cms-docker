'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/core/Button';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/components/providers/ToastProvider';
import {
  removeExposureAction,
  removeServiceAction,
  removeWiringAction,
  saveExposureAction,
  saveServiceAction,
  saveWiringAction,
} from '@/app/actions/serviceWiring';
import {
  SERVICE_ROLES,
  type ExposureRecord,
  type ServiceRecord,
  type WiringRecord,
  type WriteResult,
} from '@/lib/service-wiring-contract';
import { RegistryEntryDialog } from './RegistryEntryDialog';
import { RegistryTable, RowButtons } from './RegistryTable';
import {
  BLANK,
  draftOfExposure,
  draftOfService,
  draftOfWiring,
  optionalInt,
  optionalText,
  requiredInt,
  type ContestOption,
  type Draft,
  type Kind,
} from './registry-spec';

interface ServiceRegistryViewProps {
  services: ServiceRecord[];
  wirings: WiringRecord[];
  exposures: ExposureRecord[];
  contests: ContestOption[];
  title: string;
  description: string;
}

/** Dispatches one draft to the action that owns its kind. */
async function persist(kind: Kind, draft: Draft): Promise<WriteResult> {
  if (kind === 'service') {
    return saveServiceAction({
      name: draft.name ?? '',
      role: (draft.role ?? 'ContestWebServer') as (typeof SERVICE_ROLES)[number],
      shard: requiredInt(draft.shard),
      host: draft.host ?? '',
      http_port: optionalInt(draft.http_port),
      rpc_port: optionalInt(draft.rpc_port),
      db_profile: draft.db_profile ?? 'default',
      contest_id: optionalInt(draft.contest_id),
      enabled: draft.enabled === 'true',
    });
  }
  if (kind === 'wiring') {
    return saveWiringAction({
      from_service_id: requiredInt(draft.from_service_id),
      to_service_id: requiredInt(draft.to_service_id),
      relation: draft.relation ?? '',
      enabled: draft.enabled === 'true',
    });
  }
  return saveExposureAction({
    contest_id: requiredInt(draft.contest_id),
    hostname: draft.hostname ?? '',
    path: draft.path ?? '/',
    tls: draft.tls === 'true',
    tailnet: optionalText(draft.tailnet),
  });
}


export function ServiceRegistryView({
  services,
  wirings,
  exposures,
  contests,
  title,
  description,
}: ServiceRegistryViewProps): React.JSX.Element {
  const router = useRouter();
  const { addToast } = useToast();
  const [kind, setKind] = useState<Kind | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [pending, setPending] = useState(false);
  const confirm = useConfirm();

  const open = (next: Kind, seed: Draft): void => {
    setDraft(seed);
    setKind(next);
  };

  const finish = (result: WriteResult, done: string): void => {
    if (result.success) {
      addToast({ type: 'success', title: done });
      setKind(null);
      router.refresh();
      return;
    }
    addToast({ type: 'error', title: 'Not saved', message: result.error ?? 'unknown failure' });
  };

  /** A removal is destructive, so it is confirmed before the row is touched. */
  const remove = async (label: string, action: () => Promise<WriteResult>): Promise<void> => {
    const agreed = await confirm({
      kind: 'destructive',
      title: `Remove ${label}`,
      description: `Remove ${label} from the registry? The next config sync stops rendering it.`,
      confirmLabel: 'Remove',
    });
    if (!agreed) return;
    finish(await action(), `${label} removed`);
  };

  const submit = async (): Promise<void> => {
    if (kind === null) return;
    setPending(true);
    try {
      finish(await persist(kind, draft), `${kind} saved`);
    } finally {
      setPending(false);
    }
  };

  const nameOf = (id: number): string => services.find((s) => s.id === id)?.name ?? `#${id}`;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-medium text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">Services ({services.length})</h2>
          <Button size="sm" onClick={(): void => open('service', { ...BLANK.service })}>Add service</Button>
        </div>
        <RegistryTable
          headers={['Name', 'Role', 'Host', 'Ports', 'DB profile', 'Contest', 'Enabled', '']}
          empty="No service is registered yet."
          rows={services.map((service) => [
            service.name,
            service.role,
            service.host,
            [service.http_port === null ? null : `http ${service.http_port}`, service.rpc_port === null ? null : `rpc ${service.rpc_port}`]
              .filter((part) => part !== null)
              .join(' / '),
            service.db_profile,
            service.contest_id === null ? 'all contests' : `#${service.contest_id}`,
            service.enabled ? 'yes' : 'no',
            <RowButtons
              key={service.id}
              onEdit={(): void => open('service', draftOfService(service))}
              onDelete={(): void => { void remove(service.name, () => removeServiceAction(service.id)); }}
            />,
          ])}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">Wirings ({wirings.length})</h2>
          <Button size="sm" onClick={(): void => open('wiring', { ...BLANK.wiring })}>Add wiring</Button>
        </div>
        <RegistryTable
          headers={['From', 'Relation', 'To', 'Enabled', '']}
          empty="No wiring is registered yet."
          rows={wirings.map((wiring) => [
            nameOf(wiring.from_service_id),
            wiring.relation,
            nameOf(wiring.to_service_id),
            wiring.enabled ? 'yes' : 'no',
            <RowButtons
              key={wiring.id}
              onEdit={(): void => open('wiring', draftOfWiring(wiring))}
              onDelete={(): void => { void remove(`${nameOf(wiring.from_service_id)} -> ${nameOf(wiring.to_service_id)}`, () => removeWiringAction(wiring.id)); }}
            />,
          ])}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">Exposures ({exposures.length})</h2>
          <Button size="sm" onClick={(): void => open('exposure', { ...BLANK.exposure })}>Add exposure</Button>
        </div>
        <RegistryTable
          headers={['Contest', 'Hostname', 'Path', 'TLS', 'Tailnet', '']}
          empty="No contest is exposed yet, so no generated route is rendered."
          rows={exposures.map((exposure) => [
            `#${exposure.contest_id}`,
            exposure.hostname,
            exposure.path,
            exposure.tls ? 'yes' : 'no',
            exposure.tailnet ?? '—',
            <RowButtons
              key={exposure.id}
              onEdit={(): void => open('exposure', draftOfExposure(exposure))}
              onDelete={(): void => { void remove(`${exposure.hostname}${exposure.path}`, () => removeExposureAction(exposure.id)); }}
            />,
          ])}
        />
      </section>

      <RegistryEntryDialog
        kind={kind}
        draft={draft}
        pending={pending}
        contests={contests}
        services={services}
        onChange={(key, value): void => setDraft((current) => ({ ...current, [key]: value }))}
        onClose={(): void => setKind(null)}
        onSubmit={(): void => { void submit(); }}
      />
    </div>
  );
}
