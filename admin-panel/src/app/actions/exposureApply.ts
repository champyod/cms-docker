'use server';

import path from 'path';

import { revalidatePath } from 'next/cache';

import { recordAudit } from '@/lib/audit';
import { applyExposureArtifacts, type ApplyStage } from '@/lib/exposure-apply';
import { readFrontVhosts } from '@/lib/front-vhosts';
import {
  createFrontRunner,
  discoverFrontContainer,
  liveArtifactsDir,
  readServedCertificate,
  STAGING_DIR_NAME,
} from '@/lib/front-nginx';
import { saveExposure } from '@/lib/panel-actions';
import { ensurePermission } from '@/lib/permissions';
import type { ExposureInput, WriteResult } from '@/lib/service-wiring-contract';
import { readRegistry } from '@/lib/service-wiring-store';

const REGISTRY_PATH = '/[locale]/infrastructure/services';
const APPLY_VERB = 'service-wiring:exposure-apply';

/** The three answers the panel shows beside the row, plus a refusal that never reached a guard. */
export type ExposureApplyOutcome = 'applied' | 'refused-validation' | 'refused-nginx' | 'refused';

export interface ExposureApplyResult extends WriteResult {
  readonly outcome: ExposureApplyOutcome;
  readonly changed?: readonly string[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'not permitted';
}

/** What the audit row and the screen call the exposure a save touched. */
function namingOf(input: ExposureInput): string {
  const hostname = input.hostname.trim() === '' ? '(path only)' : input.hostname.trim();
  return `${hostname}${input.path.trim() === '' ? '/' : input.path.trim()}`;
}

/** The panel's three outcomes: a failing reload is the front refusing the change it was handed. */
function outcomeOf(stage: ApplyStage): ExposureApplyOutcome {
  return stage === 'validation' ? 'refused-validation' : 'refused-nginx';
}

async function audit(label: string, result: ExposureApplyResult, entityId?: number): Promise<void> {
  await recordAudit({
    verb: APPLY_VERB,
    entity: 'contest_exposures',
    entityId: entityId === undefined ? undefined : String(entityId),
    result: result.success ? 'success' : 'failure',
    reason: `${label}: ${result.outcome}${result.error === undefined ? '' : ` — ${result.error}`}`,
  });
}

/**
 * Saves one exposure and applies it to the running front.
 *
 * WHY the row is written before the render: the panel's editor owns what a row means, so the render
 * reads back from the database exactly what a later sync would — a save that rendered from the posted
 * form could apply something the writer refused.
 *
 * WHY the staged swap lives in `exposure-apply`: the same guard has to serve the reconciler, and a
 * second implementation of "test, swap, reload" is how one of the two would lose its staging step.
 */
export async function saveExposureApplyAction(input: ExposureInput): Promise<ExposureApplyResult> {
  try {
    await ensurePermission('container:control');
  } catch (error) {
    return { success: false, outcome: 'refused', error: messageOf(error) };
  }

  const label = namingOf(input);
  const written = await saveExposure(input);
  if (!written.success) {
    const refused: ExposureApplyResult = {
      success: false,
      outcome: 'refused-validation',
      error: written.error ?? 'the exposure row was refused',
    };
    await audit(label, refused, input.id);
    return refused;
  }

  let result: ExposureApplyResult;
  const container = await discoverFrontContainer().catch(() => null);
  if (container === null) {
    // Nothing was staged, so this is the front being absent — not nginx refusing a config.
    const refused: ExposureApplyResult = {
      success: false,
      outcome: 'refused-nginx',
      error: 'no front container is running, so the exposure was saved but not applied',
    };
    await audit(label, refused, input.id);
    return refused;
  }

  try {
    const [registry, frontVhosts] = await Promise.all([readRegistry(), readFrontVhosts()]);
    const liveDir = liveArtifactsDir();
    const outcome = await applyExposureArtifacts(registry, {
      liveDir,
      stagingDir: path.join(liveDir, STAGING_DIR_NAME),
      frontVhosts,
      front: createFrontRunner(container),
      certificate: await readServedCertificate(),
    });
    result = outcome.kind === 'applied'
      ? { success: true, outcome: 'applied', changed: [...outcome.changed] }
      : { success: false, outcome: outcomeOf(outcome.stage), error: outcome.error };
  } catch (error) {
    result = { success: false, outcome: 'refused', error: messageOf(error) };
  }

  await audit(label, result, input.id);
  if (result.success) revalidatePath(REGISTRY_PATH, 'page');
  return result;
}
