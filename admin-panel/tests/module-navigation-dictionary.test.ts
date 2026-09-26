import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function resolveKey(dictionary: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((value, segment) => {
    if (typeof value !== 'object' || value === null) return undefined;
    return Reflect.get(value, segment);
  }, dictionary);
}

function expectLabel(dictionary: unknown, key: string): void {
  const label = resolveKey(dictionary, key);
  expect(typeof label).toBe('string');
  expect(String(label).trim()).not.toBe('');
}

describe('module navigation dictionary parity', () => {
  it('resolves every enabled registry labelKey in both locales', () => {
    const enabledRoutes = ROUTE_REGISTRY.filter((descriptor) => descriptor.enabled);
    expect(enabledRoutes.length).toBeGreaterThan(0);
    for (const descriptor of enabledRoutes) {
      expect(descriptor.labelKey).toBe(`navigation.${descriptor.id}.label`);
      expectLabel(en, descriptor.labelKey);
      expectLabel(th, descriptor.labelKey);
    }
  });

  it('resolves group labels and the retained Search route label', () => {
    for (const key of [
      'navigation.groups.administration',
      'navigation.groups.infrastructure',
      'navigation.groups.system',
      'navigation.system.search.label',
    ]) {
      expectLabel(en, key);
      expectLabel(th, key);
    }
  });

  it('resolves the module page copy for every enabled module page in both locales', () => {
    for (const key of [
      'navigation.infrastructure.deployments.label',
      'navigation.infrastructure.deployments.description',
      'navigation.infrastructure.containers.label',
      'navigation.infrastructure.containers.description',
      'navigation.infrastructure.resources.label',
      'navigation.infrastructure.resources.description',
      'navigation.infrastructure.ranking.label',
      'navigation.infrastructure.ranking.description',
      'navigation.system.appearance.label',
      'navigation.system.appearance.description',
      'navigation.system.maintenance.label',
      'navigation.system.maintenance.description',
      'navigation.system.settings.label',
      'navigation.system.settings.description',
      'navigation.system.docs.label',
      'navigation.system.docs.description',
    ]) {
      expectLabel(en, key);
      expectLabel(th, key);
    }
  });

  it('resolves the module state-surface labels in both locales', () => {
    for (const key of [
      'navigation.states.loading',
      'navigation.states.error',
      'navigation.states.notFound',
      'navigation.states.retry',
    ]) {
      expectLabel(en, key);
      expectLabel(th, key);
    }
  });

  it('resolves registry label keys through the dictionary in one shared module', () => {
    const source = readSource('src/lib/navigation/module-nav.ts');
    expect(source).toContain('descriptor.labelKey');
    expect(source).toContain('labelForDescriptor(dict, descriptor)');
  });

  it.each([
    'src/app/[locale]/(authenticated)/administration/layout.tsx',
    'src/app/[locale]/(authenticated)/infrastructure/layout.tsx',
    'src/app/[locale]/(authenticated)/system/layout.tsx',
  ])('%s wires its group to the shared module rail', (relativePath) => {
    const source = readSource(relativePath);
    expect(source).toContain('getDictionary(locale)');
    expect(source).toContain('permittedNavItems(GROUP_ID, locale, dict, effective)');
    expect(source).toContain('concealedPermissions()');
    // The resolver lives in the shared module; a shell that grew its own copy is the duplication
    // this wiring exists to prevent.
    expect(source).not.toContain('descriptor.labelKey');
    expect(source).not.toContain('function labelForDescriptor');
  });

  it.each([
    'src/app/[locale]/(authenticated)/administration/loading.tsx',
    'src/app/[locale]/(authenticated)/administration/error.tsx',
    'src/app/[locale]/(authenticated)/administration/not-found.tsx',
    'src/app/[locale]/(authenticated)/infrastructure/loading.tsx',
    'src/app/[locale]/(authenticated)/infrastructure/error.tsx',
    'src/app/[locale]/(authenticated)/infrastructure/not-found.tsx',
    'src/app/[locale]/(authenticated)/system/loading.tsx',
    'src/app/[locale]/(authenticated)/system/error.tsx',
    'src/app/[locale]/(authenticated)/system/not-found.tsx',
  ])('%s reaches the dictionary without the server-only loader', (relativePath) => {
    const source = readSource(relativePath);
    expect(source).toContain('useDictionary()');
    expect(source).not.toMatch(/from ['"]@\/i18n['"]/);
  });
});
