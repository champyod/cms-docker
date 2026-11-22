import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/th/contests/42/overview',
}));

import { DetailSurface, type DetailSurfaceProps } from '@/components/core/DetailSurface';
import { PageSurface, type PageSurfaceProps } from '@/components/core/PageSurface';
import type { SurfaceStatus } from '@/components/core/SurfaceState';
import { buildRoute } from '@/lib/navigation/routes';
import type { BreadcrumbItem, RouteTab } from '@/lib/navigation/types';

const breadcrumbs: readonly BreadcrumbItem[] = [
  { label: 'Contests', href: buildRoute('th', 'contests.list') },
  { label: 'Contest 42', href: buildRoute('th', 'contests.record', { id: 42 }) },
  { label: 'Overview' },
];

const tabs: readonly RouteTab[] = [
  {
    id: 'contests.tabs.overview',
    label: 'Overview',
    href: buildRoute('th', 'contests.tabs.overview', { id: 42 }),
    icon: <span data-testid="overview-icon">O</span>,
  },
  {
    id: 'contests.tabs.settings',
    label: 'Settings',
    href: buildRoute('th', 'contests.tabs.settings', { id: 42 }),
  },
];

function renderPage(status?: SurfaceStatus): string {
  const props = {
    breadcrumbs,
    title: 'Contests',
    description: 'Manage contests',
    actions: <button type="button">Create contest</button>,
    status,
    children: <div data-testid="page-content">Page content</div>,
    className: 'fixture-page',
  } satisfies PageSurfaceProps;
  return renderToStaticMarkup(<PageSurface {...props} />);
}

function renderDetail(status?: SurfaceStatus): string {
  const props = {
    breadcrumbs,
    title: 'Contest 42',
    description: 'Contest record',
    status,
    tabs,
    actions: <button type="button">Edit contest</button>,
    children: <div data-testid="detail-content">Detail content</div>,
    className: 'fixture-detail',
  } satisfies DetailSurfaceProps;
  return renderToStaticMarkup(<DetailSurface {...props} />);
}

describe('PageSurface', () => {
  it('renders breadcrumbs, title, description, actions, and children', () => {
    const html = renderPage();
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('href="/th/contests"');
    expect(html).toContain('href="/th/contests/42"');
    expect(html).toContain('Contests');
    expect(html).toContain('Manage contests');
    expect(html).toContain('Create contest');
    expect(html).toContain('Page content');
  });

  it('keeps responsive and safe-area spacing without nesting a main element', () => {
    const html = renderPage();
    expect(html).toContain('pb-[env(safe-area-inset-bottom)]');
    expect(html).toContain('md:pb-0');
    expect(html).not.toContain('<main');
  });

  it('stacks the description inside the title column instead of beside the title', () => {
    const html = renderPage();
    // Located by structure, not by a class string: the column is the element that opens just
    // before the h1 and closes after the description. A class rename must not be able to make
    // this assertion pass on an empty slice.
    const titleAt = html.indexOf('<h1');
    const descriptionAt = html.indexOf('Manage contests');
    const actionsAt = html.indexOf('Create contest');

    expect(titleAt).toBeGreaterThan(-1);
    expect(descriptionAt).toBeGreaterThan(titleAt);
    // The description closes the same column the title opens: no closing tag between them.
    expect(html.slice(titleAt, descriptionAt)).not.toContain('</div>');
    // And the actions sit after the description, not between the title and it.
    expect(descriptionAt).toBeLessThan(actionsAt);
  });

  it('uses the exact public prop set', () => {
    const props = {
      breadcrumbs,
      title: 'Contests',
      description: 'Manage contests',
      actions: <button type="button">Create</button>,
      status: { kind: 'idle' },
      children: <div>Content</div>,
      className: 'fixture-page',
    } satisfies PageSurfaceProps;
    expect(Object.keys(props)).toEqual([
      'breadcrumbs',
      'title',
      'description',
      'actions',
      'status',
      'children',
      'className',
    ]);
  });
});

describe('DetailSurface', () => {
  it('renders route tabs, the active tab, icons, actions, and content', () => {
    const html = renderDetail();
    expect(html).toContain('href="/th/contests/42/overview"');
    expect(html).toContain('href="/th/contests/42/settings"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-testid="overview-icon"');
    expect(html).toContain('Edit contest');
    expect(html).toContain('Detail content');
  });

  it('uses the exact public prop set', () => {
    const props = {
      breadcrumbs,
      title: 'Contest 42',
      description: 'Contest record',
      status: { kind: 'idle' },
      tabs,
      actions: <button type="button">Edit</button>,
      children: <div>Content</div>,
      className: 'fixture-detail',
    } satisfies DetailSurfaceProps;
    expect(Object.keys(props)).toEqual([
      'breadcrumbs',
      'title',
      'description',
      'status',
      'tabs',
      'actions',
      'children',
      'className',
    ]);
  });
});

describe('surface state precedence', () => {
  it.each([
    [{ kind: 'loading', title: 'Loading contests' } satisfies SurfaceStatus, 'Loading contests'],
    [{ kind: 'error', title: 'Could not load contests' } satisfies SurfaceStatus, 'Could not load contests'],
    [{ kind: 'empty', title: 'No contests' } satisfies SurfaceStatus, 'No contests'],
    [{ kind: 'not-found', title: 'Not found' } satisfies SurfaceStatus, 'Not found'],
  ])('renders %s and suppresses feature children', (status, expectedText) => {
    const pageHtml = renderPage(status);
    const detailHtml = renderDetail(status);
    expect(pageHtml).toContain(expectedText);
    expect(detailHtml).toContain(expectedText);
    expect(pageHtml).not.toContain('Page content');
    expect(detailHtml).not.toContain('Detail content');
  });
});
