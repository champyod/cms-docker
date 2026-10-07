import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'src/app/globals.css'), 'utf8');
const card = readFileSync(join(__dirname, '..', 'src/components/ui/card.tsx'), 'utf8');
const badge = readFileSync(join(__dirname, '..', 'src/components/ui/badge.tsx'), 'utf8');

describe('high-contrast variant foundation', () => {
  it('declares the high-contrast custom variant', () => {
    expect(css).toContain('@custom-variant high-contrast');
    expect(css).toContain('.high-contrast');
  });

  it('re-derives the tokens that must flip with the background', () => {
    expect(css).toContain('.dark.high-contrast');
    expect(css).toMatch(/--success-foreground/);
    expect(css).toMatch(/--destructive-foreground/);
  });

  it('does not override tailwind internals', () => {
    expect(css).not.toMatch(/--spacing:\s*0\.2rem/);
  });
});

describe('high-contrast surfaces', () => {
  it('keeps the card border invisible at rest and visible in high contrast', () => {
    expect(card).toContain('border-transparent');
    expect(card).toContain('high-contrast:border-border');
  });

  it('gives status badges a solid high-contrast background with a matching foreground', () => {
    expect(badge).toContain('high-contrast:bg-success');
    expect(badge).toContain('high-contrast:text-success-foreground');
    expect(badge).toContain('high-contrast:bg-destructive');
    expect(badge).toContain('high-contrast:text-destructive-foreground');
  });
});
