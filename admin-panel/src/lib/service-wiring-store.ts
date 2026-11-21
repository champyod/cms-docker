import { prisma } from '@/lib/prisma';
import type {
  ExposureRecord,
  ServiceRecord,
  WiringRecord,
} from './service-wiring-contract';
import { PANEL_READ_TIMEOUT_MS, withTimeout } from './with-timeout';

/**
 * The read side of the service registry.
 *
 * WHY the writes are not here: the binding a registry row carries is the same fact the `./cms`
 * CLI can set while no panel server is up, so every write lives in `panel-actions` where both
 * boundaries reach it, and this module keeps only the reads the screens render.
 */

/** Everything the panel renders, in one round trip per table. */
export async function readRegistry(): Promise<{
  services: ServiceRecord[];
  wirings: WiringRecord[];
  exposures: ExposureRecord[];
}> {
  const [services, wirings, exposures] = await withTimeout(
    Promise.all([
      prisma.services.findMany({ orderBy: [{ role: 'asc' }, { shard: 'asc' }] }),
      prisma.wirings.findMany({ orderBy: { id: 'asc' } }),
      prisma.contest_exposures.findMany({ orderBy: { id: 'asc' } }),
    ]),
    PANEL_READ_TIMEOUT_MS,
    'The registry read did not finish in time.',
  );
  // WHY the panel sees '' and not null: a path-only row has no hostname and a row with no
  // image has no tag, so the form edits each absence as an empty field and the two
  // representations meet here.
  const panelExposures = exposures.map((exposure) => ({ ...exposure, hostname: exposure.hostname ?? '' }));
  const panelServices = services.map((service) => ({ ...service, image: service.image ?? '' }));
  return { services: panelServices, wirings, exposures: panelExposures };
}
