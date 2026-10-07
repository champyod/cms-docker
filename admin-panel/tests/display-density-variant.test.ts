import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'src/app/globals.css'), 'utf8');

describe('density variant foundation', () => {
  it('declares the density custom variant', () => {
    expect(css).toContain('@custom-variant density');
    expect(css).toContain('.density-compact');
  });
  it('does not override tailwind internals', () => {
    expect(css).not.toMatch(/--spacing:\s*0\.2rem/);
  });
});
