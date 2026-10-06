// @vitest-environment happy-dom
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SystemAboutPage from '@/app/[locale]/(authenticated)/system/about/page';
import en from '@/dictionaries/en.json';
import rootCredits from '../../credits.json';
import { panelCredits } from '@/lib/credits';

// The dictionary loader is server-only; the page is exercised with the real
// English copy so the rendered chrome is the copy the panel actually ships.
vi.mock('@/i18n', () => ({ getDictionary: () => Promise.resolve(en) }));

const ROOT_CREDITS_PATH = path.resolve(__dirname, '..', '..', 'credits.json');
const PANEL_CREDITS_PATH = path.resolve(__dirname, '..', 'src', 'lib', 'credits.json');
const PAGE_SOURCE_PATH = path.resolve(
  __dirname,
  '..',
  'src',
  'app',
  '[locale]',
  '(authenticated)',
  'system',
  'about',
  'page.tsx',
);

const ROOT_CREDITS = rootCredits;
const OTHER_SURFACE_KEYS = ['contest', 'admin', 'ranking'] as const;

afterEach(() => {
  cleanup();
});

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function renderPage(): Promise<HTMLElement> {
  const element = await SystemAboutPage({ params: Promise.resolve({ locale: 'en' }) });
  const { container } = render(element);
  return container;
}

describe('committed credits copy', () => {
  it('matches the repository credits file it was generated from', () => {
    expect(readJson(PANEL_CREDITS_PATH)).toStrictEqual(readJson(ROOT_CREDITS_PATH));
  });
});

describe('panelCredits', () => {
  it('reads the project, licence, and upstream the page offers', () => {
    const credits = panelCredits();
    expect(credits.projectName).toBe('CMS Docker');
    expect(credits.sourceUrl).toBe(ROOT_CREDITS.project.url);
    expect(credits.upstream).toStrictEqual({ name: 'CMS (cms-dev)', url: 'https://github.com/cms-dev/cms' });
    expect(credits.license.spdxId).toBe(ROOT_CREDITS.license.spdx_id);
    expect(credits.license.name).toBe(ROOT_CREDITS.license.name);
  });

  it('carries the panel surface in its declared order', () => {
    const panel = panelCredits().panel;
    expect(panel.title).toBe(ROOT_CREDITS.surfaces.panel.title);
    expect(panel.assets.map((asset) => asset.name))
      .toEqual(ROOT_CREDITS.surfaces.panel.assets.map((asset) => asset.name));
    expect(panel.assets).toHaveLength(24);
    expect(panel.firstParty).toStrictEqual(ROOT_CREDITS.surfaces.panel.first_party);
    expect(panel.transitiveDependencies ?? null)
      .toBe(ROOT_CREDITS.surfaces.panel.transitive_dependencies ?? null);
  });

  it('reads a version per asset without requiring one', () => {
    for (const asset of panelCredits().panel.assets) {
      expect(asset.version).toBeTypeOf('string');
      expect(asset.holder.trim()).not.toBe('');
      expect(asset.licenseId.trim()).not.toBe('');
      expect(asset.paths.length).toBeGreaterThan(0);
      expect(asset.licenseUrls.length).toBeGreaterThan(0);
    }
  });

  it('attributes the panel to its own author and to no other surface', () => {
    expect(panelCredits().panel.attribution).toStrictEqual([
      { text: 'Admin panel by CCYod', url: 'https://github.com/champyod' },
    ]);
    const foreignAttributions = OTHER_SURFACE_KEYS
      .flatMap((key) => ROOT_CREDITS.surfaces[key].attribution)
      .map((entry) => entry.text);
    expect(foreignAttributions).toContain('a fork of CMS (cms-dev)');
    expect(panelCredits().panel.attribution.map((entry) => entry.text))
      .not.toContain('a fork of CMS (cms-dev)');
  });

  it('omits every asset that belongs only to another surface', () => {
    const names = panelCredits().panel.assets.map((asset) => asset.name);
    const foreignNames = OTHER_SURFACE_KEYS
      .flatMap((key) => ROOT_CREDITS.surfaces[key].assets.map((asset) => asset.name));
    for (const foreign of [...new Set(foreignNames)]) {
      expect(names).not.toContain(foreign);
    }
  });

  it('carries no asset without a version that the panel declares one for', () => {
    const withVersion = panelCredits().panel.assets.filter((asset) => asset.version !== null);
    expect(withVersion).toHaveLength(panelCredits().panel.assets.length);
  });
});

describe('about page', () => {
  it('renders one row per panel asset and no other', async () => {
    const container = await renderPage();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(24);
    const body = within(container.querySelector('tbody') as HTMLElement);
    for (const asset of panelCredits().panel.assets) {
      expect(body.getByText(asset.name)).toBeDefined();
    }
    expect(container.textContent).not.toContain('jqPlot');
    expect(container.textContent).not.toContain('EventSource');
    expect(container.textContent).not.toContain('Tango icon theme');
    expect(container.textContent).not.toContain('a fork of CMS (cms-dev)');
  });

  it('links the attribution and the source offer to the recorded addresses', async () => {
    await renderPage();
    const attribution = screen.getByRole('link', { name: 'Admin panel by CCYod' });
    expect(attribution.getAttribute('href')).toBe('https://github.com/champyod');
    const source = screen.getByRole('link', { name: ROOT_CREDITS.project.url });
    expect(source.getAttribute('href')).toBe(ROOT_CREDITS.project.url);
  });

  it('titles the licence, the panel surface, and the software count from the dictionary', async () => {
    await renderPage();
    expect(screen.getByText(ROOT_CREDITS.license.name)).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Admin panel' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Third-party software (24)' })).toBeDefined();
  });

  it('keeps every address out of the component source', () => {
    const source = fs.readFileSync(PAGE_SOURCE_PATH, 'utf8');
    expect(source).not.toContain('https://');
    expect(source).not.toContain('http://');
  });
});