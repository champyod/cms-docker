'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Tabs } from '@/components/core/Tabs';
import { useConfirm } from '@/hooks/useConfirm';
import { useDictionary } from '@/hooks/useDictionary';
import { useToast } from '@/components/providers/ToastProvider';
import { collectWiringProblems } from '@/lib/service-wiring-problems';
import { hasEffectivePermission } from '@/lib/permission-engine';
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
import { RegistrySection } from './RegistrySection';
import { PreviewPanel } from './PreviewPanel';
import { exposureColumns, registryRowActions, serviceColumns, wiringColumns } from './registry-columns';
import { persist } from './registry-mutations';
import {
  BLANK,
  KIND_LABEL_KEY,
  copyText,
  draftOfExposure,
  draftOfService,
  draftOfWiring,
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
  permissionKeys: readonly string[];
  /** The hostnames the deployment's own front declares: an exposure must not claim one. */
  frontVhosts?: readonly string[];
}

type TabId = Kind | 'preview';

const TAB_IDS: readonly TabId[] = ['service', 'wiring', 'exposure', 'preview'];

export function ServiceRegistryView({
  services,
  wirings,
  frontVhosts = [],
  exposures,
  contests,
  title,
  description,
  permissionKeys,
}: ServiceRegistryViewProps): React.JSX.Element {
  const copy = useDictionary().infrastructure.services;
  const router = useRouter();
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<TabId>('service');
  const [kind, setKind] = useState<Kind | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [pending, setPending] = useState(false);
  const confirm = useConfirm();
  const problems = collectWiringProblems(services, wirings, exposures, frontVhosts);
  // Why the same key on both: the screen offers only what its server actions already demand.
  const canControl = hasEffectivePermission(new Set(permissionKeys), 'container:control');

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

  const nameOf = (id: number): string => services.find((service) => service.id === id)?.name ?? `#${id}`;

  const tabLabels: Record<TabId, string> = {
    service: copy.tabs.services,
    wiring: copy.tabs.wirings,
    exposure: copy.tabs.exposures,
    preview: copy.tabs.preview,
  };

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

      <Tabs
        items={TAB_IDS.map((id) => ({ id, label: tabLabels[id] }))}
        activeId={activeTab}
        ariaLabel={copy.tabs.ariaLabel}
        onSelect={(id): void => setActiveTab(id as TabId)}
      />

      {activeTab === 'service' && (
        <RegistrySection
          title={copy.kinds.service}
          count={services.length}
          empty={copy.empty.service}
          addLabel={copy.actions.addService}
          onAdd={(): void => open('service', { ...BLANK.service })}
          canAdd={canControl}
          columns={serviceColumns(copy)}
          rows={services}
          getRowKey={(service) => service.id}
          actionsHeader={copy.columns.actions}
          renderRowActions={(service) => registryRowActions(copy, permissionKeys, {
            onEdit: (): void => open('service', draftOfService(service)),
            onRemove: (): void => { void remove(service.name, () => removeServiceAction(service.id)); },
          })}
        />
      )}

      {activeTab === 'wiring' && (
        <RegistrySection
          title={copy.kinds.wiring}
          count={wirings.length}
          empty={copy.empty.wiring}
          addLabel={copy.actions.addWiring}
          onAdd={(): void => open('wiring', { ...BLANK.wiring })}
          canAdd={canControl}
          columns={wiringColumns(copy, nameOf)}
          rows={wirings}
          getRowKey={(wiring) => wiring.id}
          actionsHeader={copy.columns.actions}
          renderRowActions={(wiring) => registryRowActions(copy, permissionKeys, {
            onEdit: (): void => open('wiring', draftOfWiring(wiring)),
            onRemove: (): void => {
              void remove(
                `${nameOf(wiring.from_service_id)} -> ${nameOf(wiring.to_service_id)}`,
                () => removeWiringAction(wiring.id),
              );
            },
          })}
        />
      )}

      {activeTab === 'exposure' && (
        <RegistrySection
          title={copy.kinds.exposure}
          count={exposures.length}
          empty={copy.empty.exposure}
          addLabel={copy.actions.addExposure}
          onAdd={(): void => open('exposure', { ...BLANK.exposure })}
          canAdd={canControl}
          columns={exposureColumns(copy, nameOf)}
          rows={exposures}
          getRowKey={(exposure) => exposure.id}
          actionsHeader={copy.columns.actions}
          renderRowActions={(exposure) => registryRowActions(copy, permissionKeys, {
            onEdit: (): void => open('exposure', draftOfExposure(exposure)),
            onRemove: (): void => {
              void remove(`${exposure.hostname}${exposure.path}`, () => removeExposureAction(exposure.id));
            },
          })}
        />
      )}

      {activeTab === 'preview' && <PreviewPanel />}

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
