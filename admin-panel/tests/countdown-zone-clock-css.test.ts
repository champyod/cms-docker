import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'src/app/globals.css'), 'utf8');

describe('countdown zone clock styles', () => {
  it('sizes the reading with a clamp, so it scales with the viewport', () => {
    expect(css).toMatch(/\.countdown-zone-clock-digits\s*\{[^}]*font-size:\s*clamp\(/);
  });

  it('slots each numeral at one character, matching the component that renders them', () => {
    expect(css).toMatch(/\.countdown-zone-clock-glyph\s*\{[^}]*width:\s*1ch/);
  });

  it('holds the panel above the clock, the ornament and the other front-layer panels', () => {
    expect(css).toMatch(/\.countdown-zone-panel\s*\{[^}]*position:\s*fixed/);
    expect(css).toMatch(/\.countdown-zone-panel\s*\{[^}]*z-index:\s*50/);
  });

  it('gives the panel the width the placement maths assumes', () => {
    expect(css).toMatch(/\.countdown-zone-panel\s*\{[^}]*width:\s*20rem/);
  });
});
