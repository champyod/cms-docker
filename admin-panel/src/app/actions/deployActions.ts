'use server';

import { ensurePermission } from '@/lib/permissions';
import { recordAudit } from '@/lib/audit';
import { resolveHostComposeLocation } from '@/lib/compose-location';
import { readDeploymentModeSetting } from '@/lib/deployment-mode-file';
import { buildComposeFileFlags } from '@/lib/restart-planner';
import {
  runDeployContest,
  getActiveDeployOperation as getActiveDeployOperationLib,
  reconcileDeployOperations as reconcileDeployOperationsLib,
} from '@/lib/deploy-operations';
import type {
  ActiveDeployOperation,
  DeployContestResult,
} from '@/lib/deploy-operations';

/**
 * The contest deployment actions, kept apart from the service and maintenance ones in
 * `services.ts`: these move a contest stack, they answer what a deploy is doing, and they are the
 * only paths that carry the `deployment` entity in the audit trail.
 */

export async function deployContest(contestId: number): Promise<DeployContestResult> {
  await ensurePermission('deployment:deploy');

  // Why the deploy resolves the same three things a restart does: the contest stack is the same
  // project the make targets run, so it is brought up from the same file list, with the same
  // deployment mode deciding pull + --no-build versus --build, and with the host repository path
  // compose needs when this panel runs inside its container (see lib/compose-location.ts). Refusing
  // an undeterminable location for the same reason as a restart: a wrong project directory mounts and
  // builds the wrong files instead of failing.
  const location = await resolveHostComposeLocation();
  if (!location.ok) return { success: false, error: location.error };

  const result = await runDeployContest(contestId, {
    files: await buildComposeFileFlags(),
    mode: (await readDeploymentModeSetting()).mode,
    location: location.location,
  });
  if (result.success) {
    await recordAudit({
      verb: 'deployment:deploy',
      entity: 'deployment',
      entityId: String(contestId),
      afterValues: { contestId },
      result: 'success',
    });
  }
  return result;
}

/**
 * Applies the outcome of any deploy whose effects are still owed, so a visit to the deploy page reaches
 * the state that deploy actually left — the contest activated, or the configuration rolled back —
 * without a client having watched the operation to its end. Reuses the same settle the deploy's own
 * start runs (`reconcileDeployOperations`), which is what keeps it from double-applying an outcome: the
 * operation's record holds the claim and whether its effects landed.
 *
 * Why the deploy page's own permission rather than a mutation key: this is the deploy the operator
 * already ran reaching its end, not a new action, so whoever may look at the deploy page may let it
 * finish. Why a server action and not the page's render: settling activates a contest, and that
 * activation revalidates cached pages — which Next.js refuses from inside a render.
 */
export async function settleDeployOperations(): Promise<void> {
  await ensurePermission('deployment:list');
  await reconcileDeployOperationsLib();
}

/**
 * The active deploy operation, unaudited. Reattachability discovery calls this every
 * DEPLOY_DISCOVERY_INTERVAL_MS per mounted tab to notice a deploy another tab started, so a row
 * per call would be thousands a day from a panel doing nothing but sitting open — and the lookup
 * reconciles server side, which is why it cannot be skipped and must not be mistaken for a read.
 */
export async function fetchActiveDeployOperation(): Promise<ActiveDeployOperation | null> {
  await ensurePermission('deployment:read');
  return getActiveDeployOperationLib();
}

export async function getActiveDeployOperation(): Promise<ActiveDeployOperation | null> {
  // Gated here as well as in the fetch above, so the check this action relies on is visible where
  // the action is rather than only in the function it happens to call.
  await ensurePermission('deployment:read');
  const active = await fetchActiveDeployOperation();
  // A null result is a real answer (nothing in flight) and is recorded as one, so a panel that
  // looks leaves the same trail whichever way the lookup came back.
  await recordAudit({
    verb: 'deployment:view',
    entity: 'deployment',
    entityId: active?.operationId,
    afterValues: { operationId: active?.operationId ?? null, contestId: active?.contestId ?? null },
    result: 'success',
  });
  return active;
}
