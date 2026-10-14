import { SERVICE_ROLES } from '@/lib/service-wiring-contract';

/** The three collections the screen edits, and the shape each form collects. */
export type Kind = 'service' | 'wiring' | 'exposure';
export type Draft = Record<string, string>;

export interface FieldSpec {
  key: string;
  label: string;
  kind?: 'text' | 'number' | 'boolean' | 'select' | 'contest' | 'service';
  options?: readonly string[];
}

export interface ContestOption {
  id: number;
  name: string;
}

export const FIELDS: Record<Kind, readonly FieldSpec[]> = {
  service: [
    { key: 'name', label: 'Name' },
    { key: 'role', label: 'Role', kind: 'select', options: SERVICE_ROLES },
    { key: 'shard', label: 'Shard', kind: 'number' },
    { key: 'host', label: 'Host' },
    { key: 'http_port', label: 'HTTP port', kind: 'number' },
    { key: 'rpc_port', label: 'RPC port', kind: 'number' },
    { key: 'db_profile', label: 'DB profile' },
    { key: 'contest_id', label: 'Contest', kind: 'contest' },
    { key: 'enabled', label: 'Enabled', kind: 'boolean' },
  ],
  wiring: [
    { key: 'from_service_id', label: 'From', kind: 'service' },
    { key: 'to_service_id', label: 'To', kind: 'service' },
    { key: 'relation', label: 'Relation' },
    { key: 'enabled', label: 'Enabled', kind: 'boolean' },
  ],
  exposure: [
    { key: 'contest_id', label: 'Contest', kind: 'contest' },
    { key: 'hostname', label: 'Hostname' },
    { key: 'path', label: 'Path' },
    { key: 'tls', label: 'TLS', kind: 'boolean' },
    { key: 'tailnet', label: 'Tailnet name' },
  ],
};

export const BLANK: Record<Kind, Draft> = {
  service: { name: '', role: 'ContestWebServer', shard: '0', host: '', http_port: '', rpc_port: '', db_profile: 'default', contest_id: '', enabled: 'true' },
  wiring: { from_service_id: '', to_service_id: '', relation: 'drains', enabled: 'true' },
  exposure: { contest_id: '', hostname: '', path: '/', tls: 'true', tailnet: '' },
};

export const KIND_LABEL: Record<Kind, string> = {
  service: 'Service',
  wiring: 'Wiring',
  exposure: 'Exposure',
};

/** Empty means null, not zero: a blank optional port is an absent port. */
export function optionalInt(raw: string | undefined): number | null {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function requiredInt(raw: string | undefined): number {
  return optionalInt(raw) ?? 0;
}

export function optionalText(raw: string | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  return trimmed === '' ? null : trimmed;
}
