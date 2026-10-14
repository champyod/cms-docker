import {
  saveExposureAction,
  saveServiceAction,
  saveWiringAction,
} from '@/app/actions/serviceWiring';
import type { WriteResult } from '@/lib/service-wiring-contract';
import {
  optionalInt,
  optionalText,
  requiredInt,
  resolveRole,
  type Draft,
  type Kind,
  type ServicesCopy,
} from './registry-spec';

/** Dispatches one draft to the action that owns its kind, as an edit when the draft carries an id. */
export async function persist(kind: Kind, draft: Draft, copy: ServicesCopy): Promise<WriteResult> {
  const id = optionalInt(draft.id) ?? undefined;
  if (kind === 'service') {
    return saveServiceAction({
      id,
      name: draft.name ?? '',
      role: resolveRole(draft.role, copy.errors.unknownRole),
      shard: requiredInt(draft.shard, copy.errors.numberRequired),
      host: draft.host ?? '',
      http_port: optionalInt(draft.http_port),
      rpc_port: optionalInt(draft.rpc_port),
      db_profile: draft.db_profile ?? 'default',
      image: draft.image ?? '',
      pull_policy: draft.pull_policy ?? 'missing',
      contest_id: optionalInt(draft.contest_id),
      enabled: draft.enabled === 'true',
    });
  }
  if (kind === 'wiring') {
    return saveWiringAction({
      id,
      from_service_id: requiredInt(draft.from_service_id, copy.errors.numberRequired),
      to_service_id: requiredInt(draft.to_service_id, copy.errors.numberRequired),
      relation: draft.relation ?? '',
      enabled: draft.enabled === 'true',
    });
  }
  return saveExposureAction({
    id,
    contest_id: requiredInt(draft.contest_id, copy.errors.numberRequired),
    hostname: draft.hostname ?? '',
    path: draft.path ?? '/',
    tls: draft.tls === 'true',
    tailnet: optionalText(draft.tailnet),
  });
}
