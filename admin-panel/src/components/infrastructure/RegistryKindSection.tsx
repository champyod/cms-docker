'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  removeExposureAction,
  removeServiceAction,
  removeWiringAction,
} from '@/app/actions/serviceWiring';
import { useConfirm } from '@/hooks/useConfirm';
import { useDictionary } from '@/hooks/useDictionary';
import { useToast } from '@/components/providers/ToastProvider';
import { exposureOwnerships, type ExposureOwnership } from '@/lib/service-wiring-ownership';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { interpolate } from '@/lib/interpolate';
import type {
  ExposureRecord,
  ServiceRecord,
  WiringRecord,
  WriteResult,
} from '@/lib/service-wiring-contract';
import { RegistryEntryDialog } from './RegistryEntryDialog';
import { RegistrySection } from './RegistrySection';
import { ExposureApplyNotice, type ExposureApplyReport } from './ExposureApplyNotice';
import { exposureColumns, registryRowActions, serviceColumns, wiringColumns } from './registry-columns';
import { persist, type RegistryWriteResult } from './registry-mutations';
import {
  BLANK,
  KIND_LABEL_KEY,
  copyText,
  draftOfExposure,
  draftOfService,
  draftOfWiring,
  exposureDraftLabel,
  type ContestOption,
  type Draft,
  type Kind,
} from './registry-spec';

interface RegistryKindSectionProps {
  /** The one record kind this section lists; the page mounts one section per kind. */
  readonly kind: Kind;
  readonly services: ServiceRecord[];
  readonly wirings: WiringRecord[];
  readonly exposures: ExposureRecord[];
  readonly contests: ContestOption[];
  readonly permissionKeys: readonly string[];
  /** The hostnames the deployment's own front declares: an exposure must not claim one. */
  readonly frontVhosts: readonly string[];
}

/**
 * One record kind of the registry: its rows, its add and edit dialog, and its removal.
 *
 * WHY the state is here and not on the page: the dialog, the pending flag and the front's verdict
 * all describe a single save against a single kind, and a board section is the largest thing they
 * can be scoped to without one kind's half-finished edit bleeding into another's.
 *
 * WHY it takes the raw records instead of columns: the columns carry render functions, which a
 * server page cannot hand to a client component — and the row actions they render are the same
 * permission-gated cluster for every kind.
 */
export function RegistryKindSection({
  kind,
  services,
  wirings,
  exposures,
  contests,
  permissionKeys,
  frontVhosts,
}: RegistryKindSectionProps): React.JSX.Element {
  const copy = useDictionary().infrastructure.services;
  const router = useRouter();
  const { addToast } = useToast();
  const [openKind, setOpenKind] = useState<Kind | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [pending, setPending] = useState(false);
  const [applyReport, setApplyReport] = useState<ExposureApplyReport | null>(null);
  const confirm = useConfirm();
  // The ownership comes from the renderer's own refusal rule, so the screen and the sync cannot
  // disagree about which route `config.toml` owns.
  const owners = exposureOwnerships(exposures, services, frontVhosts);
  const ownerById = new Map<number, ExposureOwnership | null>(exposures.map((exposure, index) => [exposure.id, owners[index]]));
  const ownershipOf = (id: number): ExposureOwnership | null => ownerById.get(id) ?? null;
  // Why the same key on both: the screen offers only what its server actions already demand.
  const canControl = hasEffectivePermission(new Set(permissionKeys), 'container:control');
  const nameOf = (id: number): string => services.find((service) => service.id === id)?.name ?? `#${id}`;

  const open = (next: Kind, seed: Draft): void => {
    setDraft(seed);
    setOpenKind(next);
  };

  /** Keeps the front's verdict on the screen, not only in a toast the operator may miss. */
  const finish = (result: RegistryWriteResult, done: string, rowLabel?: string): void => {
    if (result.outcome !== undefined) {
      setApplyReport({ label: rowLabel ?? done, outcome: result.outcome, error: result.error });
    }
    if (result.success) {
      addToast({ type: 'success', title: result.outcome === 'applied' ? copy.apply.applied : done });
      setOpenKind(null);
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
    if (openKind === null) return;
    setPending(true);
    try {
      const label = copyText(copy, KIND_LABEL_KEY[openKind]);
      const rowLabel = openKind === 'exposure' ? exposureDraftLabel(draft) : label;
      finish(await persist(openKind, draft, copy), interpolate(copy.toast.savedTitle, { kind: label }), rowLabel);
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

  return (
    <div className="space-y-4">
      {kind === 'exposure' && <ExposureApplyNotice report={applyReport} />}

      {kind === 'service' && (
        <RegistrySection
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

      {kind === 'wiring' && (
        <RegistrySection
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

      {kind === 'exposure' && (
        <RegistrySection
          empty={copy.empty.exposure}
          addLabel={copy.actions.addExposure}
          onAdd={(): void => open('exposure', { ...BLANK.exposure })}
          canAdd={canControl}
          columns={exposureColumns(copy, nameOf, ownershipOf)}
          rows={exposures}
          getRowKey={(exposure) => exposure.id}
          actionsHeader={copy.columns.actions}
          renderRowActions={(exposure) => registryRowActions(copy, permissionKeys, {
            // A curated route is moved in `config.toml`; offering an editor here would promise a
            // change the next sync refuses.
            onEdit: ownershipOf(exposure.id)?.kind === 'curated'
              ? undefined
              : (): void => open('exposure', draftOfExposure(exposure)),
            onRemove: (): void => {
              void remove(`${exposure.hostname}${exposure.path}`, () => removeExposureAction(exposure.id));
            },
          })}
        />
      )}

      <RegistryEntryDialog
        kind={openKind}
        draft={draft}
        pending={pending}
        contests={contests}
        services={services}
        onChange={(key, value): void => setDraft((current) => ({ ...current, [key]: value }))}
        onClose={(): void => setOpenKind(null)}
        onSubmit={(): void => { void submit(); }}
      />
    </div>
  );
}
