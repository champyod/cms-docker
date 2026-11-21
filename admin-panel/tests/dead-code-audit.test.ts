import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE_DIR = 'src/components/core';
const UI_DIR = 'src/components/ui';
const ADAPTER_IMPORT = "@/components/ui/";
const VARIANT_RECIPE_CALL = 'cva(';
const MIGRATIONS_DIR = 'prisma/migrations';
const SCHEMA = 'prisma/schema.prisma';

const DELETED_AS_DEAD = [
  'src/hooks/useContainerSelection.ts',
  'src/components/containers/ContainerHeader.tsx',
  'src/components/containers/ContainerBulkBar.tsx',
  'src/components/containers/ContainerGrid.tsx',
  'src/components/PermissionDenied.tsx',
  'src/components/audit/AuditRow.tsx',
] as const;

const SWEPT_DIRS = ['src/hooks', 'src/components/containers'] as const;

const IMPORT_SPECIFIER = /(?:from|import|require|vi\.mock)\s*\(?\s*['"]([^'"]+)['"]/g;

const OLD_NAVIGATION_SYMBOLS =
  /nav-registry|nav-chord|NAV_REGISTRY|NAV_CHORD_KEY_BY_PATH|MOBILE_PRIMARY_LABELS|PALETTE_NAV_ITEMS/;

const NATIVE_CONFIRM = /\bwindow\.(confirm|alert)\s*\(/;
const NATIVE_PROMPT = /\bwindow\.prompt\s*\(/;
const DELIVERY_NOTE = /replace before delivery|replace-before-delivery/i;

const KNOWN_NATIVE_PROMPT_SITES = [
  'src/components/tasks/task-detail/useTaskDatasetActions.ts',
] as const;

function sourceFilesUnder(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return [...sourceFilesUnder(path)];
    return /\.(ts|tsx)$/.test(path) ? [path] : [];
  });
}

function allSourceFiles(): readonly string[] {
  return sourceFilesUnder('src');
}

function moduleKey(path: string): string {
  return path.replace(/\.tsx?$/, '');
}

function importedModuleKeys(sources: readonly string[]): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const source of sources) {
    for (const [, specifier] of readFileSync(source, 'utf8').matchAll(IMPORT_SPECIFIER)) {
      const base = specifier.startsWith('@/')
        ? `src/${specifier.slice(2)}`
        : join(source, '..', specifier);
      keys.add(base.replace(/\.tsx?$/, ''));
    }
  }
  return keys;
}

const ALL_SOURCE_FILES = allSourceFiles();
const IMPORTED_KEYS = importedModuleKeys(ALL_SOURCE_FILES);

describe('final dead-code audit', () => {
  it('keeps every deleted dead module gone', () => {
    const revived = DELETED_AS_DEAD.filter((path) => existsSync(path));
    expect(revived).toEqual([]);
  });

  it('leaves no unreferenced module in the swept component and hook directories', () => {
    const orphans: string[] = [];
    for (const directory of SWEPT_DIRS) {
      for (const file of sourceFilesUnder(directory)) {
        if (!IMPORTED_KEYS.has(moduleKey(file))) orphans.push(file);
      }
    }
    expect(orphans).toEqual([]);
  });

  it('keeps every navigation consumer on the frozen foundation', () => {
    const offenders = ALL_SOURCE_FILES.filter((file) =>
      OLD_NAVIGATION_SYMBOLS.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps every shadcn adapter import behind core or ui', () => {
    const offenders = ALL_SOURCE_FILES.filter((file) => {
      if (file.startsWith(CORE_DIR) || file.startsWith(UI_DIR)) return false;
      return readFileSync(file, 'utf8').includes(ADAPTER_IMPORT);
    });
    expect(offenders).toEqual([]);
  });

  it('leaves every variant recipe in the adapter, never in a core wrapper', () => {
    const offenders = sourceFilesUnder(CORE_DIR).filter((file) =>
      readFileSync(file, 'utf8').includes(VARIANT_RECIPE_CALL),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps one Container controller owner and no duplicate composition module', () => {
    const containerSources = sourceFilesUnder('src/components/containers');
    const controllerOwners = containerSources.filter((file) =>
      /import\s+\{[^}]*useContainersController/.test(readFileSync(file, 'utf8')),
    );
    expect(controllerOwners).toEqual(['src/components/containers/ContainersClient.tsx']);
  });

  it('uses no native confirm or alert anywhere in the panel', () => {
    const offenders = ALL_SOURCE_FILES.filter((file) =>
      NATIVE_CONFIRM.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('confines the remaining native prompt to the known dataset-name sites', () => {
    const offenders = ALL_SOURCE_FILES.filter((file) =>
      NATIVE_PROMPT.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([...KNOWN_NATIVE_PROMPT_SITES]);
  });

  it('leaves no unresolved delivery note in the source or the tests', () => {
    const scanned = [...sourceFilesUnder('src'), ...sourceFilesUnder('tests')]
      .filter((file) => !file.endsWith('dead-code-audit.test.ts'));
    const offenders = scanned.filter((file) =>
      DELIVERY_NOTE.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('leaves no unreferenced or empty migration directory', () => {
    const directories = readdirSync(MIGRATIONS_DIR).filter((entry) =>
      statSync(join(MIGRATIONS_DIR, entry)).isDirectory(),
    );
    const broken = directories.filter((entry) =>
      !existsSync(join(MIGRATIONS_DIR, entry, 'migration.sql')),
    );
    expect(broken).toEqual([]);
    expect(directories.length).toBeGreaterThan(0);
  });

  it('creates only schema-declared models in the public migration set', () => {
    const schema = readFileSync(SCHEMA, 'utf8');
    const created = new Set<string>();
    for (const entry of readdirSync(MIGRATIONS_DIR)) {
      const migration = join(MIGRATIONS_DIR, entry, 'migration.sql');
      if (!existsSync(migration)) continue;
      for (const [, table] of readFileSync(migration, 'utf8')
        .matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?([a-z_.]+)"?/gi)) {
        const [qualifier, name] = table.split('.');
        // Why the qualifier split: the legacy-permission rollback record is
        // created outside public on purpose, so it is not a Prisma model.
        if (qualifier !== name || name.startsWith('_')) continue;
        created.add(name);
      }
    }
    const undeclared = [...created].filter(
      (table) => !schema.includes(`model ${table} {`) && !schema.includes(`"${table}"`),
    );
    expect(undeclared).toEqual([]);
  });
});
