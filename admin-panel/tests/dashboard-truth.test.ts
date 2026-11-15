import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PAGE = resolve(__dirname, '../src/app/[locale]/(authenticated)/page.tsx');

describe('the overview states only measured facts', () => {
  const source = readFileSync(PAGE, 'utf8');

  it('carries no trend glyph', () => {
    expect(source).not.toMatch(/ArrowUpRight|TrendingUp|ArrowDownRight/);
  });

  it('makes no success claim about a number it did not compute', () => {
    expect(source).not.toMatch(/text-success/);
  });

  it('counts the people it names, from participations in running contests', () => {
    expect(source).toMatch(/participations\.count/);
    expect(source).toMatch(/start:\s*\{\s*lte:\s*now\s*\}/);
    expect(source).toMatch(/stop:\s*\{\s*gte:\s*now\s*\}/);
  });
});
