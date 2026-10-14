'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/core/Button';
import { useConfirm } from '@/hooks/useConfirm';
import { useDictionary } from '@/hooks/useDictionary';
import { useToast } from '@/components/providers/ToastProvider';
import { collectWiringProblems } from '@/lib/service-wiring';
import { interpolate } from '@/lib/interpolate';
import {
  removeExposureAction,
  removeServiceAction,
  removeWiringAction,
} from '@/app/actions/serviceWiring';
import {
  type ExposureRecord,
  type ServiceRecord,
  type WiringRecord,
  type WriteResult,
} from '@/lib/service-wiring-contract';
import { RegistryEntryDialog } from './RegistryEntryDialog';
import { RegistryTable, RowButtons } from './RegistryTable';
import { persist } from './registry-mutations';
import {
  BLANK,
  COLUMNS,
  KIND_LABEL_KEY,
  copyText,
  draftOfExposure,
  draftOfService,
  draftOfWiring,
  type ContestOption,
  type Draft,
  type Kind,
  type ServicesCopy,
} from './registry-spec';

interface ServiceRegistryViewProps {
  services: ServiceRecord[];
  wirings: WiringRecord[];
  exposures: ExposureRecord[];
  contests: ContestOption[];
  title: string;
  description: string;
}

/** The header cells one kind's table shows, resolved from the dictionary by path. */
function headersFor(kind: Kind, copy: ServicesCopy): string[] {
  return COLUMNS[kind].map((column) => copyText(copy, column.labelKey));
}

export function ServiceRegistryView({
  services,
  wirings,
  exposures,
  contests,
  title,
  description,
}: ServiceRegistryViewProps): React.JSX.Element {
  const copy = useDictionary().infrastructure.services;
  const router = useRouter();
  const { addToast } = useToast();
  const [kind, setKind] = useState<Kind | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [pending, setPending] = useState(false);
  const confirm = useConfirm();
  const problems = collectWiringProblems(services, wirings, exposures);

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
    addToast({ type: 'error', title: copy.toast.errorTitle, message: result.error ?? copy.toast.errorFallback });
  };

  /** A removal is destructive, so it is confirmed before the row is touched. */
  const remove = async (label: string, action: () => Promise<WriteResult>): Promise<void> => {
    const agreed = await confirm({
      kind: 'destructive',
      title: interpolate(copy.confirm.title, { label }),
      description: interpolate(copy.confirm.description, { label }),
      confirmLabel: copy.confirm.confirmLabel,
    });
    if (!agreed) return;
    finish(await action(), interpolate(copy.toast.removedTitle, { label }));
  };

  const submit = async (): Promise<void> => {
    if (kind === null) return;
    setPending(true);
    try {
      const label = copyText(copy, KIND_LABEL_KEY[kind]);
      finish(await persist(kind, draft, copy), interpolate(copy.toast.savedTitle, { kind: label }));
    } catch (error) {
      addToast({
        type: 'error',
        title: copy.toast.errorTitle,
        message: error instanceof Error ? error.message : copy.toast.unexpected,
      });
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

      {problems.length > 0 && (
        <section className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
          <h2 className="text-sm font-medium text-destructive">
            {interpolate(problems.length === 1 ? copy.problems.one : copy.problems.title, { count: problems.length })}
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
            {problems.map((problem) => (
              <li key={`${problem.area}:${problem.message}`}>{problem.message}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">{copy.kinds.service} ({services.length})</h2>
          <Button size="sm" onClick={(): void => open('service', { ...BLANK.service })}>{copy.actions.addService}</Button>
        </div>
        <RegistryTable
          headers={headersFor('service', copy)}
          empty={copy.empty.service}
          rows={services.map((service) => [
            service.name,
            service.role,
            service.host,
            [
              service.http_port === null ? null : `${copy.values.http} ${service.http_port}`,
              service.rpc_port === null ? null : `${copy.values.rpc} ${service.rpc_port}`,
            ].filter((part) => part !== null).join(' / '),
            service.db_profile,
            service.contest_id === null ? copy.values.allContests : `#${service.contest_id}`,
            service.enabled ? copy.values.yes : copy.values.no,
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
          <h2 className="text-sm font-medium text-foreground">{copy.kinds.wiring} ({wirings.length})</h2>
          <Button size="sm" onClick={(): void => open('wiring', { ...BLANK.wiring })}>{copy.actions.addWiring}</Button>
        </div>
        <RegistryTable
          headers={headersFor('wiring', copy)}
          empty={copy.empty.wiring}
          rows={wirings.map((wiring) => [
            nameOf(wiring.from_service_id),
            wiring.relation,
            nameOf(wiring.to_service_id),
            wiring.enabled ? copy.values.yes : copy.values.no,
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
          <h2 className="text-sm font-medium text-foreground">{copy.kinds.exposure} ({exposures.length})</h2>
          <Button size="sm" onClick={(): void => open('exposure', { ...BLANK.exposure })}>{copy.actions.addExposure}</Button>
        </div>
        <RegistryTable
          headers={headersFor('exposure', copy)}
          empty={copy.empty.exposure}
          rows={exposures.map((exposure) => [
            `#${exposure.contest_id}`,
            exposure.hostname,
            exposure.path,
            exposure.tls ? copy.values.yes : copy.values.no,
            exposure.tailnet ?? copy.values.none,
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
