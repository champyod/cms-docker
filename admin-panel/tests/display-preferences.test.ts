import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DENSITY_COOKIE_NAME,
  NO_FLASH_DISPLAY_SCRIPT,
  TEXT_SIZE_COOKIE_NAME,
} from '@/lib/display-density';

/**
 * Display preferences span three files that cannot see each other: a hook that writes a cookie, a
 * pre-paint script that turns that cookie into classes on <html>, and stylesheet rules keyed on
 * those class names. Nothing type-checks across that boundary, so a rename in any one of them turns
 * the setting into a control that saves a preference and changes nothing — the failure is silent by
 * construction, which is why it is pinned here.
 */

const PANEL_ROOT = path.resolve(__dirname, '..');
const CSS = fs.readFileSync(path.join(PANEL_ROOT, 'src/app/globals.css'), 'utf8');

describe('display preferences reach the stylesheet', () => {
  it('names the classes the stylesheet keys on', () => {
    // The density class is literal; the text-size ones are composed from a validated value
    // (`'text-size-' + t`), so the prefix and the three allowed values are what must agree with CSS.
    expect(NO_FLASH_DISPLAY_SCRIPT).toContain('density-compact');
    expect(NO_FLASH_DISPLAY_SCRIPT).toContain("'text-size-'");
    for (const size of ["'small'", "'medium'", "'large'"]) {
      expect(NO_FLASH_DISPLAY_SCRIPT, `${size} is not an allowed text size`).toContain(size);
    }
  });

  it('reads the cookies the hook writes', () => {
    expect(NO_FLASH_DISPLAY_SCRIPT).toContain(DENSITY_COOKIE_NAME);
    expect(NO_FLASH_DISPLAY_SCRIPT).toContain(TEXT_SIZE_COOKIE_NAME);
  });

  it('has a rule for every text size the script applies', () => {
    for (const size of ['small', 'medium', 'large']) {
      expect(CSS, `no rule for text-size-${size}`).toMatch(
        new RegExp(`\\.text-size-${size}\\s*\\{`),
      );
    }
  });

  it('retunes spacing for compact density at the token level', () => {
    // WHY: the compact preference used to be honoured only where a component happened to carry a
    // `density:` variant — 10 of 501 files — so choosing it changed almost nothing. Tailwind v4
    // derives every spacing utility from `--spacing`, and the built CSS keeps that indirection, so
    // one override covers the whole panel. Element-qualified to outrank Tailwind's `:root`.
    expect(CSS).toMatch(/html\.density-compact\s*\{[^}]*--spacing\s*:/);
  });
});
