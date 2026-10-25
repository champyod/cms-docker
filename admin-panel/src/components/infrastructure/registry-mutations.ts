import {
  saveExposureApplyAction,
  type ExposureApplyResult,
} from '@/app/actions/exposureApply';
import {
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

/** What a save answers: a plain write for two kinds, the front's own verdict for an exposure. */
export type RegistryWriteResult = WriteResult & Partial<Pick<ExposureApplyResult, 'outcome' | 'changed'>>;

/**
 * Dispatches one draft to the action that owns its kind, as an edit when the draft carries an id.
 *
 * WHY an exposure is saved through its own action: a route reaches the front by being written AND
 * applied, and the panel learns which of the two failed from that action's outcome.
 */
export async function persist(kind: Kind, draft: Draft, copy: ServicesCopy): Promise<RegistryWriteResult> {
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
  return saveExposureApplyAction({
    id,
    service_id: requiredInt(draft.service_id, copy.errors.numberRequired),
    hostname: draft.hostname ?? '',
    path: draft.path ?? '/',
    tls: draft.tls === 'true',
    tailnet: optionalText(draft.tailnet),
  });
}
