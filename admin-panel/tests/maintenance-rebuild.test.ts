import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildRebuildCommand, type RebuildStack } from '@/lib/make-command';
import type { DeploymentMode } from '@/lib/deployment-mode';

const STACKS: readonly RebuildStack[] = ['core', 'admin', 'worker', 'all'];
const MODES: readonly DeploymentMode[] = ['img', 'src'];

// What the Makefile's stack targets branch on ("DEPLOYMENT_TYPE_OVERRIDE … takes precedence over
// files"), so the panel's mode, read from config.toml, reaches the recipe's own img/src decision.
describe('the rebuild action runs the canonical target in the configured mode', () => {
  it('img: pulls and recreates without building', (): void => {
    expect(buildRebuildCommand('core', 'img')).toBe('DEPLOYMENT_TYPE_OVERRIDE=img make core');
  });

  it('src: builds from source', (): void => {
    expect(buildRebuildCommand('admin', 'src')).toBe('DEPLOYMENT_TYPE_OVERRIDE=src make admin');
  });

  it('worker keeps its own target', (): void => {
    expect(buildRebuildCommand('worker', 'img')).toBe('DEPLOYMENT_TYPE_OVERRIDE=img make worker');
  });

  it('all covers the three deployable stacks, each in the mode', (): void => {
    expect(buildRebuildCommand('all', 'src')).toBe(
      'DEPLOYMENT_TYPE_OVERRIDE=src make core && DEPLOYMENT_TYPE_OVERRIDE=src make admin && DEPLOYMENT_TYPE_OVERRIDE=src make worker',
    );
  });

  it('all carries the mode into every target of the chain', (): void => {
    expect(buildRebuildCommand('all', 'img')).toBe(
      'DEPLOYMENT_TYPE_OVERRIDE=img make core && DEPLOYMENT_TYPE_OVERRIDE=img make admin && DEPLOYMENT_TYPE_OVERRIDE=img make worker',
    );
  });
});

describe('the rebuild command stays inside what the Makefile offers', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const readMakefile = (): Promise<string> => fs.readFile(path.join(repoRoot, 'Makefile'), 'utf-8');

  it('never uses the deprecated aliases, which force image mode', async (): Promise<void> => {
    for (const stack of STACKS) {
      for (const mode of MODES) {
        expect(buildRebuildCommand(stack, mode)).not.toMatch(/make [a-z-]*-img\b/);
      }
    }
  });

  it('names targets the Makefile declares', async (): Promise<void> => {
    const makefile = await readMakefile();
    for (const stack of STACKS) {
      for (const mode of MODES) {
        const segments = buildRebuildCommand(stack, mode).split(' && ');
        expect(segments.length).toBeGreaterThan(0);
        for (const segment of segments) {
          const match = /^DEPLOYMENT_TYPE_OVERRIDE=(img|src) make ([a-z-]+)$/.exec(segment);
          expect(match).not.toBeNull();
          if (match === null) continue;
          expect(match[1]).toBe(mode);
          expect(makefile).toMatch(new RegExp(`^${match[2]}:$`, 'm'));
        }
      }
    }
  });

  it('uses the switch the Makefile reads', async (): Promise<void> => {
    expect(await readMakefile()).toContain('DEPLOYMENT_TYPE_OVERRIDE');
  });
});
