import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/contests/7/overview',
}));

import { DetailSurface } from '@/components/core/DetailSurface';
import { buildRoute } from '@/lib/navigation/routes';
import type { RouteTab, RouteId } from '@/lib/navigation/types';

const contestKeys = [
  'contests.tabs.overview',
  'contests.tabs.tasks',
  'contests.tabs.participants',
  'contests.tabs.communications',
  'contests.tabs.settings',
] as const;
const taskKeys = ['tasks.tabs.overview', 'tasks.tabs.datasets', 'tasks.tabs.files', 'tasks.tabs.settings'] as const;

function tabsFor(locale: string, keys: readonly RouteId[], id: number): readonly RouteTab[] {
  return keys.map((key) => ({
    id: key,
    label: key,
    href: buildRoute(locale, key, { id }),
  }));
}

function renderTabs(tabs: readonly RouteTab[]): string {
  return renderToStaticMarkup(
    <DetailSurface breadcrumbs={[{ label: 'Record' }]} title="Record" tabs={tabs}>
      <div>Content</div>
    </DetailSurface>,
  );
}

function anchorHrefs(html: string): string[] {
  return [...html.matchAll(/<a[^>]*href="([^"]*)"/g)].map((match) => match[1]);
}

describe('detail tab link contract', () => {
  it('renders every Contest tab as an anchor with the canonical href', () => {
    const tabs = tabsFor('en', contestKeys, 7);
    const hrefs = anchorHrefs(renderTabs(tabs));
    for (const tab of tabs) expect(hrefs).toContain(tab.href);
  });

  it('renders every Task tab as an anchor with the canonical href', () => {
    const tabs = tabsFor('en', taskKeys, 7);
    const hrefs = anchorHrefs(renderTabs(tabs));
    for (const tab of tabs) expect(hrefs).toContain(tab.href);
  });

  it('preserves the locale across Contest and Task descriptors', () => {
    for (const locale of ['en', 'th'] as const) {
      const contestHrefs = anchorHrefs(renderTabs(tabsFor(locale, contestKeys, 7)));
      const taskHrefs = anchorHrefs(renderTabs(tabsFor(locale, taskKeys, 7)));
      expect(contestHrefs.length).toBeGreaterThan(0);
      expect(taskHrefs.length).toBeGreaterThan(0);
      for (const href of [...contestHrefs, ...taskHrefs]) expect(href.startsWith(`/${locale}/`)).toBe(true);
    }
  });

  it('keeps query-string tabs out of the rendered rail', () => {
    const html = renderTabs([...tabsFor('en', contestKeys, 7), ...tabsFor('en', taskKeys, 7)]);
    expect(html).not.toContain('?tab=');
  });

  it('uses the frozen link-backed tab path instead of local tab state', () => {
    const html = renderTabs(tabsFor('en', contestKeys, 7));
    expect(html).not.toContain('<button');
    const surfaceSource = readFileSync(resolve(__dirname, '..', 'src/components/core/DetailSurface.tsx'), 'utf8');
    const tabsSource = readFileSync(resolve(__dirname, '..', 'src/components/core/SurfaceTabs.tsx'), 'utf8');
    expect(surfaceSource).not.toContain('useState');
    expect(tabsSource).not.toContain('useState');
    expect(tabsSource).not.toContain('onSelect');
  });

  it('leaves route prefetching enabled for every record tab', () => {
    const tabsSource = readFileSync(resolve(__dirname, '..', 'src/components/core/Tabs.tsx'), 'utf8');
    expect(tabsSource).not.toContain('prefetch={false}');
    const surfaceSource = readFileSync(resolve(__dirname, '..', 'src/components/core/DetailSurface.tsx'), 'utf8');
    if (surfaceSource.includes('prefetch')) expect(surfaceSource).not.toContain('prefetch={false}');
  });
});
