import type { DeploymentMode } from '@/lib/deployment-mode';

/** The stacks the rebuild action offers, which are the Makefile's deployable stacks. */
export type RebuildStack = 'core' | 'admin' | 'worker' | 'all';

/**
 * The make target per stack, out of what the Makefile actually offers. The `*-img` aliases this used
 * to call are deprecated and force image mode, so the canonical stack targets are used instead and the
 * mode travels in the environment (see below).
 */
const REBUILD_TARGETS: Readonly<Record<RebuildStack, readonly string[]>> = {
  core: ['core'],
  admin: ['admin'],
  worker: ['worker'],
  // No 'all' target exists; the three deployable stacks the panel's 'all' button means, in order.
  all: ['core', 'admin', 'worker'],
};

/**
 * The command the rebuild action runs for a stack in a deployment mode.
 *
 * Why the target does not encode the mode but DEPLOYMENT_TYPE_OVERRIDE does: `make <stack>` branches
 * on DEPLOYMENT_TYPE, which lives in .env and is only written by a previous `./cms config sync` —
 * while this panel reads config.toml directly. The prefix states the mode the panel actually read,
 * which is the switch the Makefile documents for exactly this purpose ("DEPLOYMENT_TYPE_OVERRIDE …
 * takes precedence over files"). So img pulls the images and recreates without building, and src
 * builds from source; the hardcoded alias made every mode pull (see the Makefile's `img` branch).
 */
export function buildRebuildCommand(stack: RebuildStack, mode: DeploymentMode): string {
  return REBUILD_TARGETS[stack]
    .map(target => `DEPLOYMENT_TYPE_OVERRIDE=${mode} make ${target}`)
    .join(' && ');
}
