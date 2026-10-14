import { SERVICE_ROLES, type ExposureRecord, type ServiceRecord, type ServiceRole, type WiringRecord } from '@/lib/service-wiring-contract';
import type { Dictionary } from '@/lib/dictionary';

/** The registry screen's copy, resolved from `infrastructure.services` in the active dictionary. */
export type ServicesCopy = Dictionary['infrastructure']['services'];

/** The three collections the screen edits, and the shape each form collects. */
export type Kind = 'service' | 'wiring' | 'exposure';
export type Draft = Record<string, string>;

export interface FieldSpec {
  key: string;
  /** A path under `infrastructure.services`, never the label itself, so copy stays in the dictionary. */
  labelKey: string;
  kind?: 'text' | 'number' | 'boolean' | 'select' | 'contest' | 'service';
  options?: readonly string[];
}

export interface ContestOption {
  id: number;
  name: string;
}

export const FIELDS: Record<Kind, readonly FieldSpec[]> = {
  service: [
    { key: 'name', labelKey: 'fields.name' },
    { key: 'role', labelKey: 'fields.role', kind: 'select', options: SERVICE_ROLES },
    { key: 'shard', labelKey: 'fields.shard', kind: 'number' },
    { key: 'host', labelKey: 'fields.host' },
    { key: 'http_port', labelKey: 'fields.httpPort', kind: 'number' },
    { key: 'rpc_port', labelKey: 'fields.rpcPort', kind: 'number' },
    { key: 'db_profile', labelKey: 'fields.dbProfile' },
    { key: 'contest_id', labelKey: 'fields.contest', kind: 'contest' },
    { key: 'enabled', labelKey: 'fields.enabled', kind: 'boolean' },
  ],
  wiring: [
    { key: 'from_service_id', labelKey: 'fields.from', kind: 'service' },
    { key: 'to_service_id', labelKey: 'fields.to', kind: 'service' },
    { key: 'relation', labelKey: 'fields.relation' },
    { key: 'enabled', labelKey: 'fields.enabled', kind: 'boolean' },
  ],
  exposure: [
    { key: 'contest_id', labelKey: 'fields.contest', kind: 'contest' },
    { key: 'hostname', labelKey: 'fields.hostname' },
    { key: 'path', labelKey: 'fields.path' },
    { key: 'tls', labelKey: 'fields.tls', kind: 'boolean' },
    { key: 'tailnet', labelKey: 'fields.tailnet' },
  ],
};

export const BLANK: Record<Kind, Draft> = {
  service: { name: '', role: 'ContestWebServer', shard: '0', host: '', http_port: '', rpc_port: '', db_profile: 'default', contest_id: '', enabled: 'true' },
  wiring: { from_service_id: '', to_service_id: '', relation: 'drains', enabled: 'true' },
  exposure: { contest_id: '', hostname: '', path: '/', tls: 'true', tailnet: '' },
};

export const KIND_LABEL_KEY: Record<Kind, string> = {
  service: 'kinds.service',
  wiring: 'kinds.wiring',
  exposure: 'kinds.exposure',
};

/** Resolves an `infrastructure.services` path to its copy, leaving the path visible when a key is missing. */
export function copyText(copy: ServicesCopy, path: string): string {
  let current: unknown = copy;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) return path;
    current = Reflect.get(current, segment) as unknown;
  }
  return typeof current === 'string' ? current : path;
}

/** Empty means null, not zero: a blank optional port is an absent port. */
export function optionalInt(raw: string | undefined): number | null {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A required whole number: a blank or unparseable entry is refused with the caller's copy, never read as zero. */
export function requiredInt(raw: string | undefined, message: string): number {
  const parsed = optionalInt(raw);
  if (parsed === null) throw new Error(message);
  return parsed;
}

/** The role a draft names, refused with the caller's copy rather than cast when it is not one the build offers. */
export function resolveRole(raw: string | undefined, message: string): ServiceRole {
  const value = raw ?? '';
  const role = SERVICE_ROLES.find((candidate) => candidate === value);
  if (role === undefined) throw new Error(message);
  return role;
}

export function optionalText(raw: string | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/** A record as the form that edits it expects, with empty meaning absent. */
export function draftOfService(service: ServiceRecord): Draft {
  return {
    id: String(service.id),
    name: service.name,
    role: service.role,
    shard: String(service.shard),
    host: service.host,
    http_port: service.http_port === null ? '' : String(service.http_port),
    rpc_port: service.rpc_port === null ? '' : String(service.rpc_port),
    db_profile: service.db_profile,
    contest_id: service.contest_id === null ? '' : String(service.contest_id),
    enabled: String(service.enabled),
  };
}

export function draftOfWiring(wiring: WiringRecord): Draft {
  return {
    id: String(wiring.id),
    from_service_id: String(wiring.from_service_id),
    to_service_id: String(wiring.to_service_id),
    relation: wiring.relation,
    enabled: String(wiring.enabled),
  };
}

export function draftOfExposure(exposure: ExposureRecord): Draft {
  return {
    id: String(exposure.id),
    contest_id: String(exposure.contest_id),
    hostname: exposure.hostname,
    path: exposure.path,
    tls: String(exposure.tls),
    tailnet: exposure.tailnet ?? '',
  };
}
