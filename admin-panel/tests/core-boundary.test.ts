import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE_DIR = 'src/components/core';
const UI_DIR = 'src/components/ui';
const ADAPTER_IMPORT = "@/components/ui/";
const VARIANT_RECIPE_CALL = 'cva(';
const FEATURE_ROOTS: readonly string[] = [
  '@/components/admins',
  '@/components/contests',
  '@/components/groups',
  '@/components/submissions',
  '@/components/tasks',
  '@/components/teams',
  '@/components/users',
  '@/components/containers',
];

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function toPosix(file: string): string {
  return file.split(sep).join('/');
}

function sourceFilesUnder(directory: string): string[] {
  return filesUnder(directory).filter((file) => /\.(ts|tsx)$/.test(file));
}

function isInside(file: string, directory: string): boolean {
  const normalized = toPosix(file);
  return normalized === directory || normalized.startsWith(`${directory}/`);
}

function uiImportOffenders(): string[] {
  return sourceFilesUnder('src').filter((file) => {
    if (isInside(file, CORE_DIR) || isInside(file, UI_DIR)) return false;
    return readFileSync(file, 'utf8').includes(ADAPTER_IMPORT);
  });
}

function coreFeatureImportOffenders(): string[] {
  return sourceFilesUnder(CORE_DIR).filter((file) => {
    const source = readFileSync(file, 'utf8');
    return FEATURE_ROOTS.some((root) => source.includes(root));
  });
}

function parallelRecipeOffenders(): string[] {
  return sourceFilesUnder(CORE_DIR).filter((file) =>
    readFileSync(file, 'utf8').includes(VARIANT_RECIPE_CALL)
  );
}

describe('core/ui boundary', () => {
  it('keeps ui imports behind core or ui', () => {
    expect(uiImportOffenders()).toEqual([]);
  });

  it('keeps feature imports out of core', () => {
    expect(coreFeatureImportOffenders()).toEqual([]);
  });

  it('leaves every variant recipe in the adapter, never in a core wrapper', () => {
    // Why: a core wrapper that redeclares `cva` for a family the adapter already
    // styles ships two sources for one look, and the two drift apart silently.
    expect(parallelRecipeOffenders()).toEqual([]);
  });
});
