import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'src/app/globals.css'), 'utf8');

describe('density variant foundation', () => {
  it('declares the density custom variant', () => {
    expect(css).toContain('@custom-variant density');
    expect(css).toContain('.density-compact');
  });
  it('overrides spacing only inside the preference scope, never on the root', () => {
    // WHY this replaced a blanket "does not override tailwind internals": that rule was written
    // after an author-CSS override was believed not to survive the production minifier. Measured on
    // this Tailwind version, it does — the built stylesheet keeps `padding:calc(var(--spacing)*N)`
    // and emits `density-compact{--spacing:.2rem}` verbatim. The property worth keeping is scope:
    // a preference class may retune a token, and `:root` may not, or the retune leaks into every
    // user regardless of their setting.
    expect(css).toMatch(/html\.density-compact\s*\{[^}]*--spacing\s*:/);
    expect(css).not.toMatch(/:root\s*\{[^}]*--spacing\s*:/);
  });
});
