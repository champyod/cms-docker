import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readRootSource(relativeFromRoot: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', relativeFromRoot), 'utf8');
}

/** Pulls the tab ids out of the one PERSPECTIVE_IDS list both sides declare. */
function perspectiveIds(source: string): string[] {
  const declaration = source.match(/PERSPECTIVE_IDS[^=]*=\s*\[([^\]]*)\]/);
  if (!declaration) throw new Error('PERSPECTIVE_IDS was not found');
  return [...declaration[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

const RUST_REGISTRY = 'ranking-web/src/perspectives.rs';
const PANEL_ACTION = 'admin-panel/src/app/actions/rankingAppearance.ts';

describe('ranking perspective registry', () => {
  // The panel validates against its own list and the crate drops ids it does not know,
  // so the two lists drifting would leave an operator able to save a tab the board
  // silently refuses to draw.
  it('keeps the panel tab list in step with the crate registry', () => {
    expect(perspectiveIds(readRootSource(PANEL_ACTION))).toEqual(
      perspectiveIds(readRootSource(RUST_REGISTRY)),
    );
  });

  it('lists the board first so an empty config still has a default', () => {
    expect(perspectiveIds(readRootSource(RUST_REGISTRY))[0]).toBe('board');
  });
});
