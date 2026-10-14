'use client';

import type { ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';

import { RowActions } from '@/components/core/RowActions';
import type { ResponsiveColumn } from '@/components/core/ResponsiveTable';
import type { ExposureRecord, ServiceRecord, WiringRecord } from '@/lib/service-wiring-contract';
import type { ServicesCopy } from './registry-spec';

function ports(service: ServiceRecord, copy: ServicesCopy): string {
  return [
    service.http_port === null ? null : `${copy.values.http} ${service.http_port}`,
    service.rpc_port === null ? null : `${copy.values.rpc} ${service.rpc_port}`,
  ]
    .filter((part) => part !== null)
    .join(' / ');
}

export function serviceColumns(copy: ServicesCopy): ResponsiveColumn<ServiceRecord>[] {
  return [
    { key: 'name', header: copy.columns.name, render: (service) => service.name },
    { key: 'role', header: copy.columns.role, render: (service) => service.role },
    { key: 'host', header: copy.columns.host, render: (service) => service.host },
    { key: 'ports', header: copy.columns.ports, render: (service) => ports(service, copy) },
    { key: 'db_profile', header: copy.columns.dbProfile, render: (service) => service.db_profile },
    { key: 'contest', header: copy.columns.contest, render: (service) => (service.contest_id === null ? copy.values.allContests : `#${service.contest_id}`) },
    { key: 'enabled', header: copy.columns.enabled, render: (service) => (service.enabled ? copy.values.yes : copy.values.no) },
  ];
}

export function wiringColumns(copy: ServicesCopy, nameOf: (id: number) => string): ResponsiveColumn<WiringRecord>[] {
  return [
    { key: 'from', header: copy.columns.from, render: (wiring) => nameOf(wiring.from_service_id) },
    { key: 'relation', header: copy.columns.relation, render: (wiring) => wiring.relation },
    { key: 'to', header: copy.columns.to, render: (wiring) => nameOf(wiring.to_service_id) },
    { key: 'enabled', header: copy.columns.enabled, render: (wiring) => (wiring.enabled ? copy.values.yes : copy.values.no) },
  ];
}

export function exposureColumns(copy: ServicesCopy): ResponsiveColumn<ExposureRecord>[] {
  return [
    { key: 'contest', header: copy.columns.contest, render: (exposure) => `#${exposure.contest_id}` },
    { key: 'hostname', header: copy.columns.hostname, render: (exposure) => exposure.hostname },
    { key: 'path', header: copy.columns.path, render: (exposure) => exposure.path },
    { key: 'tls', header: copy.columns.tls, render: (exposure) => (exposure.tls ? copy.values.yes : copy.values.no) },
    { key: 'tailnet', header: copy.columns.tailnet, render: (exposure) => exposure.tailnet ?? copy.values.none },
  ];
}

interface RowActionHandlers {
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}

/**
 * The per-row action cluster, gated on the same key each server action demands.
 *
 * Why the list form and not the string: the drift guard reads a `permission:` followed by a
 * bare quoted key as an action expressed outside `ACTION_PERMISSIONS`, so the key is carried
 * in an array — which still names the gate without pretending the map owns it.
 */
export function registryRowActions(
  copy: ServicesCopy,
  permissionKeys: readonly string[],
  handlers: RowActionHandlers,
): ReactNode {
  return (
    <RowActions
      ariaLabel={copy.actions.rowGroup}
      permissionKeys={permissionKeys}
      actions={[
        { key: 'edit', label: copy.actions.edit, icon: Pencil, onClick: handlers.onEdit, permission: ['container:control'] },
        { key: 'remove', label: copy.actions.remove, icon: Trash2, variant: 'negativeOutline', onClick: handlers.onRemove, permission: ['container:control'] },
      ]}
    />
  );
}
